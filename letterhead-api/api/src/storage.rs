//! The bucket: the logos and backgrounds of letterhead versions (tasks T12 and T15; AC-3.8, AC-7.4, AC-7.7).
//!
//! It reads, and it writes an asset once, when it is uploaded ([`Storage::put`]); there is no overwrite and no
//! delete here (AC-4.6). A version's assets are immutable (AC-4.6, ADR 20261116-letterhead-versions-assets-and-
//! change-record-are-immutable-in-the-database), so what is read for one asset id is read for ever and the
//! supervisor keeps it, by id: [`Storage::asset`] answers from memory after the first read. These bytes are not
//! document content (AC-3.7): they are the stationery, the same for every document of an entity. A document's
//! own images are never stored: they arrive in the request and go to the worker.
//!
//! What is read is checked against the database row that describes it (size and SHA-256), so a bucket object
//! that was replaced or damaged is refused rather than drawn on a client's document, and nothing unchecked is
//! cached.
//!
//! The object name of an asset is `assets/<id>` (plan § Data model). The S3 client is built from the validated
//! [`S3Config`]: the EU-residency guard has already run in `env.rs`. A non-AWS endpoint (MinIO, Railway's
//! bucket) is addressed path-style, as `crm-api` does.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use aws_sdk_s3::Client;
use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region, timeout::TimeoutConfig};
use aws_sdk_s3::error::SdkError;
use aws_sdk_s3::operation::get_object::GetObjectError;
use aws_sdk_s3::primitives::ByteStream;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::AssetRow;
use crate::env::{S3Config, is_aws_s3_endpoint};

/// The most that the cache holds. An asset is at most 2 MiB; a version uses at most six.
const CACHE_BYTES: usize = 64 * 1024 * 1024;
/// One attempt, and the whole operation with its retries. A render waits for these, so they are short.
const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(5);
const OPERATION_TIMEOUT: Duration = Duration::from_secs(10);

/// Why an asset could not be had. None of these carries an object name, an id or a message of the bucket.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageError {
    /// The bucket has no object for this asset: the database and the bucket disagree. Not transient.
    Missing,
    /// The object is not what the database says it is (size or SHA-256). Not transient.
    Corrupt,
    /// The bucket did not answer in time, or answered with an error. Worth a retry.
    Unavailable,
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            StorageError::Missing => "asset_missing",
            StorageError::Corrupt => "asset_corrupt",
            StorageError::Unavailable => "storage_unavailable",
        })
    }
}

impl std::error::Error for StorageError {}

pub struct Storage {
    client: Client,
    bucket: String,
    cache: Mutex<Cache>,
}

impl Storage {
    pub fn new(config: &S3Config) -> Storage {
        Storage::with_timeouts(config, ATTEMPT_TIMEOUT, OPERATION_TIMEOUT)
    }

    pub fn with_timeouts(config: &S3Config, attempt: Duration, operation: Duration) -> Storage {
        let credentials = Credentials::new(
            config.access_key_id.expose(),
            config.secret_access_key.expose(),
            None,
            None,
            "letterhead-api-env",
        );
        let timeouts = TimeoutConfig::builder()
            .operation_attempt_timeout(attempt)
            .operation_timeout(operation)
            .build();
        let client_config = aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(config.region.clone()))
            .endpoint_url(config.endpoint.as_str().trim_end_matches('/'))
            .credentials_provider(credentials)
            .force_path_style(!is_aws_s3_endpoint(&config.endpoint))
            .timeout_config(timeouts)
            .build();
        Storage {
            client: Client::from_conf(client_config),
            bucket: config.bucket.clone(),
            cache: Mutex::new(Cache::default()),
        }
    }

    /// The object name of an asset.
    pub fn object_name(id: Uuid) -> String {
        format!("assets/{id}")
    }

    /// The stored bytes of an asset, checked against its row. From memory when they were read before.
    pub async fn asset(&self, row: &AssetRow) -> Result<Arc<Vec<u8>>, StorageError> {
        if let Some(held) = self.lock().get(row.id) {
            return Ok(held);
        }
        let bytes = Arc::new(self.read(row).await?);
        self.lock().put(row.id, Arc::clone(&bytes));
        Ok(bytes)
    }

    /// Store the bytes of a newly uploaded asset under its object name (AC-7.4: the service's own bucket). `id`
    /// is server-chosen and new, so nothing is overwritten. The caller writes the database row only after this
    /// returns: a failure here leaves no row, and an object that no row names cannot be reached by anything.
    pub async fn put(
        &self,
        id: Uuid,
        bytes: &[u8],
        content_type: &'static str,
    ) -> Result<(), StorageError> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .set_key(Some(Storage::object_name(id)))
            .content_type(content_type)
            .body(ByteStream::from(bytes.to_vec()))
            .send()
            .await
            .map(|_| ())
            .map_err(|_| StorageError::Unavailable)
    }

    fn lock(&self) -> MutexGuard<'_, Cache> {
        self.cache.lock().unwrap_or_else(PoisonError::into_inner)
    }

    async fn read(&self, row: &AssetRow) -> Result<Vec<u8>, StorageError> {
        let expected = usize::try_from(row.bytes).map_err(|_| StorageError::Corrupt)?;
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .set_key(Some(Storage::object_name(row.id)))
            .send()
            .await
            .map_err(|error| match &error {
                SdkError::ServiceError(e) if matches!(e.err(), GetObjectError::NoSuchKey(_)) => {
                    StorageError::Missing
                }
                _ => StorageError::Unavailable,
            })?;
        // The row says how big the object is: read no more than that, so a replaced object of any size costs
        // this much memory and no more.
        let mut body = output.body;
        let mut bytes = Vec::with_capacity(expected);
        loop {
            match body.try_next().await {
                Ok(Some(chunk)) => {
                    if bytes.len() + chunk.len() > expected {
                        return Err(StorageError::Corrupt);
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(_) => return Err(StorageError::Unavailable),
            }
        }
        if bytes.len() != expected || Sha256::digest(&bytes)[..] != row.sha256[..] {
            return Err(StorageError::Corrupt);
        }
        Ok(bytes)
    }
}

/// Verified assets by id, oldest out first once the total passes [`CACHE_BYTES`].
#[derive(Default)]
struct Cache {
    held: HashMap<Uuid, Arc<Vec<u8>>>,
    order: VecDeque<Uuid>,
    bytes: usize,
}

impl Cache {
    fn get(&self, id: Uuid) -> Option<Arc<Vec<u8>>> {
        self.held.get(&id).cloned()
    }

    fn put(&mut self, id: Uuid, bytes: Arc<Vec<u8>>) {
        if self.held.contains_key(&id) {
            return;
        }
        self.bytes += bytes.len();
        self.held.insert(id, bytes);
        self.order.push_back(id);
        while self.bytes > CACHE_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(gone) = self.held.remove(&oldest) {
                self.bytes -= gone.len();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(size: usize) -> Arc<Vec<u8>> {
        Arc::new(vec![7; size])
    }

    #[test]
    fn the_cache_answers_by_id_and_keeps_the_first_bytes_it_was_given() {
        let mut cache = Cache::default();
        let id = Uuid::new_v4();
        assert!(cache.get(id).is_none());
        cache.put(id, bytes(10));
        cache.put(id, bytes(20));
        assert_eq!(cache.get(id).expect("held").len(), 10);
        assert_eq!(cache.bytes, 10);
    }

    #[test]
    fn the_cache_drops_the_oldest_when_it_is_over_its_size() {
        let mut cache = Cache::default();
        let ids: Vec<Uuid> = (0..4).map(|_| Uuid::new_v4()).collect();
        for id in &ids {
            cache.put(*id, bytes(CACHE_BYTES / 3));
        }
        assert!(cache.bytes <= CACHE_BYTES);
        assert!(cache.get(ids[0]).is_none(), "the oldest is out");
        assert!(
            cache.get(ids[1]).is_some(),
            "only as many go as the size needs"
        );
        assert!(cache.get(ids[3]).is_some(), "the newest stays");
    }

    #[test]
    fn the_object_name_of_an_asset_is_assets_slash_its_id() {
        let id = Uuid::parse_str("3f2b8a64-9b0c-4d5e-8f1a-0123456789ab").expect("uuid");
        assert_eq!(
            Storage::object_name(id),
            "assets/3f2b8a64-9b0c-4d5e-8f1a-0123456789ab"
        );
    }
}

//! Integration tests of the schema and the repository, against a real Postgres (task T10).
//!
//! The guarantees under test are properties of the database (triggers, foreign keys, locks), so a mock would
//! prove nothing. Set `LETTERHEAD_TEST_DATABASE_URL` to a Postgres URL (compose's is
//! `postgres://postgres:postgres@localhost:5435/<a database of your own>`); each test makes its own schema in
//! it, with its own copy of every table, so tests do not see each other and a run leaves nothing a later run
//! can trip on. Schemas are never dropped by the tests: rows of these tables cannot be deleted, by design, so
//! the cleanup is dropping the test database, which is for the person running them.
//!
//! Without the variable the tests are skipped with a notice; `LETTERHEAD_REQUIRE_DB_TESTS=1` (set in CI) turns
//! a missing variable into a failure, so a pipeline cannot go green without them.

use letterhead_engine::assets::Format;
use letterhead_engine::content::Entity;
use serde_json::json;
use sqlx::Executor;
use sqlx::postgres::{PgPool, PgPoolOptions};
use uuid::Uuid;

use super::*;

const URL_VAR: &str = "LETTERHEAD_TEST_DATABASE_URL";
const REQUIRE_VAR: &str = "LETTERHEAD_REQUIRE_DB_TESTS";

/// A repository on a schema of its own, migrated; `None` (skip) when there is no test database.
async fn repo() -> Option<Repo> {
    let repo = unmigrated().await?;
    repo.migrate().await.expect("migrate");
    Some(repo)
}

/// A repository on a schema of its own with nothing in it; `None` (skip) when there is no test database.
async fn unmigrated() -> Option<Repo> {
    let Ok(url) = std::env::var(URL_VAR) else {
        assert!(
            std::env::var(REQUIRE_VAR).as_deref() != Ok("1"),
            "{URL_VAR} is not set and {REQUIRE_VAR}=1: the database tests may not be skipped"
        );
        eprintln!("SKIPPED: set {URL_VAR} to run the database tests");
        return None;
    };
    let schema = format!("lh_t_{}", Uuid::new_v4().simple());
    let admin = PgPool::connect(&url)
        .await
        .expect("connect to the test database");
    // The schema name is `lh_t_` and 32 hex digits, made here: nothing a person typed reaches the statement.
    admin
        .execute(sqlx::AssertSqlSafe(format!("create schema {schema}")))
        .await
        .expect("create the test schema");
    admin.close().await;

    let pool = PgPoolOptions::new()
        .max_connections(8)
        .after_connect(move |conn, _| {
            let set = format!("set search_path to {schema}");
            Box::pin(async move {
                conn.execute(sqlx::AssertSqlSafe(set)).await?;
                Ok(())
            })
        })
        .connect(&url)
        .await
        .expect("connect with the test schema");
    Some(Repo::new(pool))
}

fn pool(repo: &Repo) -> &PgPool {
    // The tests run raw statements, as someone with access to the database could.
    repo.pool_for_tests()
}

fn asset(entity: Entity, kind: AssetKind) -> NewAsset {
    NewAsset {
        id: Uuid::new_v4(),
        entity,
        kind,
        format: Format::Png,
        sha256: [7; 32],
        bytes: 1234,
        size_px: Some((300, 120)),
        created_by: "user-1".into(),
    }
}

fn config(marker: &str) -> serde_json::Value {
    json!({ "margins": { "top": 25, "bottom": 25, "left": 25, "right": 25 }, "marker": marker })
}

fn save(entity: Entity, base: i32, marker: &str, assets: &[Uuid]) -> NewVersion {
    NewVersion {
        entity,
        base_version: base,
        layout_version: 1,
        config: config(marker),
        asset_ids: assets.to_vec(),
        actor_sub: "user-1".into(),
        actor_name: "Ada Lovelace".into(),
        changed_settings: vec!["margins".into(), "fonts".into()],
    }
}

fn restore(entity: Entity, from: i32, base: i32) -> RestoreVersion {
    RestoreVersion {
        entity,
        from_version: from,
        base_version: base,
        actor_sub: "user-2".into(),
        actor_name: "Grace Hopper".into(),
        changed_settings: vec!["fonts".into()],
    }
}

async fn count(repo: &Repo, table: &str) -> i64 {
    // `table` is one of this file's own literals.
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("select count(*) from {table}")))
        .fetch_one(pool(repo))
        .await
        .expect("count")
}

async fn raw(repo: &Repo, statement: &'static str) -> Result<u64, sqlx::Error> {
    sqlx::query(statement)
        .execute(pool(repo))
        .await
        .map(|r| r.rows_affected())
}

fn refused_as_immutable(result: Result<u64, sqlx::Error>, what: &str) {
    match result {
        Err(sqlx::Error::Database(e)) => {
            assert!(
                e.message().starts_with("letterhead_immutable"),
                "{what}: refused, but by something else: {}",
                e.message()
            );
        }
        other => panic!("{what}: expected the immutability trigger to refuse, got {other:?}"),
    }
}

mod versions {
    use super::*;

    #[tokio::test]
    async fn the_first_save_is_version_1_and_is_active_at_once() {
        let Some(repo) = repo().await else { return };
        assert!(
            repo.active_version(Entity::WelldIt)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(repo.active_versions().await.unwrap(), vec![]);

        assert_eq!(
            repo.save(save(Entity::WelldIt, 0, "a", &[])).await.unwrap(),
            1
        );
        let active = repo.active_version(Entity::WelldIt).await.unwrap().unwrap();
        assert_eq!((active.version, active.layout_version), (1, 1));
        assert_eq!(active.config, config("a"));
        assert_eq!(active.created_by, "user-1");
        assert_eq!(active.restored_from, None);

        assert_eq!(
            repo.save(save(Entity::WelldIt, 1, "b", &[])).await.unwrap(),
            2
        );
        assert_eq!(
            repo.active_version(Entity::WelldIt)
                .await
                .unwrap()
                .unwrap()
                .config,
            config("b")
        );
        // the previous version stays, and can be named (AC-4.1, 4.4)
        assert_eq!(
            repo.version(Entity::WelldIt, 1)
                .await
                .unwrap()
                .unwrap()
                .config,
            config("a")
        );
        assert!(repo.version(Entity::WelldIt, 3).await.unwrap().is_none());
        assert!(repo.version(Entity::WelldIt, 0).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn each_entity_is_numbered_from_1_on_its_own() {
        let Some(repo) = repo().await else { return };
        repo.save(save(Entity::WelldIt, 0, "it1", &[]))
            .await
            .unwrap();
        repo.save(save(Entity::WelldIt, 1, "it2", &[]))
            .await
            .unwrap();
        assert_eq!(
            repo.save(save(Entity::WelldCh, 0, "ch1", &[]))
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            repo.active_versions().await.unwrap(),
            vec![(Entity::WelldCh, 1), (Entity::WelldIt, 2)]
        );
        // never another entity's (AC-4.4)
        assert_eq!(
            repo.active_version(Entity::WelldCh)
                .await
                .unwrap()
                .unwrap()
                .config,
            config("ch1")
        );
        assert!(repo.version(Entity::WelldCh, 2).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_save_on_a_stale_base_is_refused_and_writes_nothing() {
        let Some(repo) = repo().await else { return };
        repo.save(save(Entity::WelldIt, 0, "a", &[])).await.unwrap();
        repo.save(save(Entity::WelldIt, 1, "b", &[])).await.unwrap();
        for base in [0, 1, 3, 99, -1] {
            match repo.save(save(Entity::WelldIt, base, "stale", &[])).await {
                Err(SaveError::VersionConflict { current }) => {
                    assert_eq!(current, 2, "base {base}")
                }
                other => panic!("base {base}: {other:?}"),
            }
        }
        assert_eq!(count(&repo, "letterhead_version").await, 2);
        assert_eq!(count(&repo, "letterhead_change").await, 2);
        // what the other person saved is not lost (AC-4.8)
        assert_eq!(
            repo.active_version(Entity::WelldIt)
                .await
                .unwrap()
                .unwrap()
                .config,
            config("b")
        );
        // and the right base still works
        assert_eq!(
            repo.save(save(Entity::WelldIt, 2, "c", &[])).await.unwrap(),
            3
        );
    }

    #[tokio::test]
    async fn of_many_saves_on_the_same_base_exactly_one_wins() {
        let Some(repo) = repo().await else { return };
        repo.save(save(Entity::WelldIt, 0, "base", &[]))
            .await
            .unwrap();
        let mut tasks = Vec::new();
        for n in 0..8 {
            let repo = repo.clone();
            tasks.push(tokio::spawn(async move {
                repo.save(save(Entity::WelldIt, 1, &format!("racer-{n}"), &[]))
                    .await
            }));
        }
        let mut won = 0;
        let mut conflicts = 0;
        for task in tasks {
            match task.await.unwrap() {
                Ok(version) => {
                    assert_eq!(version, 2);
                    won += 1;
                }
                Err(SaveError::VersionConflict { current }) => {
                    assert_eq!(current, 2);
                    conflicts += 1;
                }
                other => panic!("{other:?}"),
            }
        }
        assert_eq!((won, conflicts), (1, 7));
        assert_eq!(count(&repo, "letterhead_version").await, 2);
        assert_eq!(count(&repo, "letterhead_change").await, 2);
    }

    #[tokio::test]
    async fn saves_of_two_entities_do_not_wait_for_each_other_or_conflict() {
        let Some(repo) = repo().await else { return };
        let (a, b) = tokio::join!(
            repo.save(save(Entity::WelldIt, 0, "it", &[])),
            repo.save(save(Entity::WelldCh, 0, "ch", &[]))
        );
        assert_eq!((a.unwrap(), b.unwrap()), (1, 1));
    }

    #[tokio::test]
    async fn the_change_record_says_who_when_and_which_settings() {
        let Some(repo) = repo().await else { return };
        repo.save(save(Entity::WelldIt, 0, "a", &[])).await.unwrap();
        repo.restore(restore(Entity::WelldIt, 1, 1)).await.unwrap();
        let history = repo.history(Entity::WelldIt).await.unwrap();
        assert_eq!(history.len(), 2);
        // newest first
        let (restored, saved) = (&history[0], &history[1]);
        assert_eq!((saved.version, saved.action.as_str()), (1, "save"));
        assert_eq!(
            (saved.actor_sub.as_str(), saved.actor_name.as_str()),
            ("user-1", "Ada Lovelace")
        );
        assert_eq!(saved.changed_settings, ["margins", "fonts"]);
        assert_eq!((saved.restored_from, saved.layout_version), (None, 1));
        assert_eq!((restored.version, restored.action.as_str()), (2, "restore"));
        assert_eq!(
            (restored.actor_sub.as_str(), restored.actor_name.as_str()),
            ("user-2", "Grace Hopper")
        );
        assert_eq!(restored.changed_settings, ["fonts"]);
        assert_eq!(restored.restored_from, Some(1));
        assert!(restored.at >= saved.at);
        // no content in the record: a config is not in it
        assert!(!format!("{history:?}").contains("marker"));
        assert!(repo.history(Entity::WelldCh).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_failed_save_leaves_no_trace_and_the_same_base_still_works() {
        let Some(repo) = repo().await else { return };
        // an asset that is not there: the foreign key refuses the link, the whole save rolls back
        let ghost = Uuid::new_v4();
        assert!(matches!(
            repo.save(save(Entity::WelldIt, 0, "x", &[ghost])).await,
            Err(SaveError::AssetUnavailable)
        ));
        assert_eq!(count(&repo, "letterhead_version").await, 0);
        assert_eq!(count(&repo, "letterhead_version_asset").await, 0);
        assert_eq!(count(&repo, "letterhead_change").await, 0);
        assert_eq!(
            repo.save(save(Entity::WelldIt, 0, "y", &[])).await.unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn an_empty_actor_is_refused_by_the_database() {
        let Some(repo) = repo().await else { return };
        let mut bad = save(Entity::WelldIt, 0, "x", &[]);
        bad.actor_name = String::new();
        assert!(matches!(repo.save(bad).await, Err(SaveError::Db(_))));
        assert_eq!(
            count(&repo, "letterhead_version").await,
            0,
            "the version went with it"
        );
    }
}

mod restores {
    use super::*;

    #[tokio::test]
    async fn restoring_2_when_4_is_active_makes_5_equal_to_2_and_changes_nothing_else() {
        let Some(repo) = repo().await else { return };
        let logo = repo
            .insert_asset(asset(Entity::WelldIt, AssetKind::Logo))
            .await
            .unwrap();
        let bg = repo
            .insert_asset(asset(Entity::WelldIt, AssetKind::Background))
            .await
            .unwrap();
        repo.save(save(Entity::WelldIt, 0, "v1", &[]))
            .await
            .unwrap();
        let mut v2 = save(Entity::WelldIt, 1, "v2", &[logo.id, bg.id]);
        v2.layout_version = 1;
        repo.save(v2).await.unwrap();
        repo.save(save(Entity::WelldIt, 2, "v3", &[logo.id]))
            .await
            .unwrap();
        repo.save(save(Entity::WelldIt, 3, "v4", &[]))
            .await
            .unwrap();

        let before: Vec<_> = {
            let mut all = Vec::new();
            for n in 1..=4 {
                all.push(repo.version(Entity::WelldIt, n).await.unwrap().unwrap());
            }
            all
        };
        let history_before = repo.history(Entity::WelldIt).await.unwrap();

        assert_eq!(
            repo.restore(restore(Entity::WelldIt, 2, 4)).await.unwrap(),
            5
        );

        let v5 = repo.active_version(Entity::WelldIt).await.unwrap().unwrap();
        assert_eq!(v5.version, 5);
        assert_eq!(v5.config, config("v2"));
        assert_eq!(v5.layout_version, 1);
        assert_eq!(v5.restored_from, Some(2));
        assert_eq!(v5.created_by, "user-2");
        let mut want: Vec<_> = vec![logo.id, bg.id];
        want.sort();
        let mut got: Vec<_> = repo
            .version_assets(Entity::WelldIt, 5)
            .await
            .unwrap()
            .iter()
            .map(|a| a.id)
            .collect();
        got.sort();
        assert_eq!(got, want, "the same logos and background");
        // 2 and the rest of the history are as they were
        for (n, version) in before.iter().enumerate() {
            assert_eq!(
                &repo
                    .version(Entity::WelldIt, n as i32 + 1)
                    .await
                    .unwrap()
                    .unwrap(),
                version
            );
        }
        let history = repo.history(Entity::WelldIt).await.unwrap();
        assert_eq!(&history[1..], history_before.as_slice());
        assert_eq!(
            (
                history[0].version,
                history[0].action.as_str(),
                history[0].restored_from
            ),
            (5, "restore", Some(2))
        );
    }

    #[tokio::test]
    async fn a_restore_keeps_the_layout_the_old_version_was_saved_with() {
        let Some(repo) = repo().await else { return };
        let mut v1 = save(Entity::WelldIt, 0, "old layout", &[]);
        v1.layout_version = 1;
        repo.save(v1).await.unwrap();
        let mut v2 = save(Entity::WelldIt, 1, "new layout", &[]);
        v2.layout_version = 2;
        repo.save(v2).await.unwrap();
        repo.restore(restore(Entity::WelldIt, 1, 2)).await.unwrap();
        assert_eq!(
            repo.version(Entity::WelldIt, 3)
                .await
                .unwrap()
                .unwrap()
                .layout_version,
            1
        );
        repo.restore(restore(Entity::WelldIt, 2, 3)).await.unwrap();
        assert_eq!(
            repo.version(Entity::WelldIt, 4)
                .await
                .unwrap()
                .unwrap()
                .layout_version,
            2
        );
    }

    #[tokio::test]
    async fn a_restore_of_a_version_that_does_not_exist_or_on_a_stale_base_is_refused() {
        let Some(repo) = repo().await else { return };
        repo.save(save(Entity::WelldIt, 0, "a", &[])).await.unwrap();
        for from in [0, 2, 99, -1] {
            assert!(
                matches!(
                    repo.restore(restore(Entity::WelldIt, from, 1)).await,
                    Err(SaveError::NotFound)
                ),
                "from {from}"
            );
        }
        assert!(matches!(
            repo.restore(restore(Entity::WelldIt, 1, 0)).await,
            Err(SaveError::VersionConflict { current: 1 })
        ));
        // another entity's version number is not a version of this one
        repo.save(save(Entity::WelldCh, 0, "ch", &[]))
            .await
            .unwrap();
        repo.save(save(Entity::WelldCh, 1, "ch2", &[]))
            .await
            .unwrap();
        assert!(matches!(
            repo.restore(restore(Entity::WelldIt, 2, 1)).await,
            Err(SaveError::NotFound)
        ));
        assert_eq!(count(&repo, "letterhead_version").await, 3);
        assert_eq!(count(&repo, "letterhead_change").await, 3);
    }
}

mod assets {
    use super::*;

    #[tokio::test]
    async fn an_asset_is_recorded_as_uploaded() {
        let Some(repo) = repo().await else { return };
        let png = asset(Entity::WelldIt, AssetKind::Logo);
        let row = repo.insert_asset(png.clone()).await.unwrap();
        assert_eq!(repo.asset(png.id).await.unwrap().unwrap(), row);
        assert_eq!(
            (row.entity, row.kind, row.format),
            (Entity::WelldIt, AssetKind::Logo, Format::Png)
        );
        assert_eq!(
            (row.bytes, row.size_px, row.sha256.as_slice()),
            (1234, Some((300, 120)), &[7u8; 32][..])
        );

        let svg = NewAsset {
            format: Format::Svg,
            size_px: None,
            kind: AssetKind::Background,
            ..asset(Entity::WelldIt, AssetKind::Logo)
        };
        let row = repo.insert_asset(svg.clone()).await.unwrap();
        assert_eq!(
            (row.format, row.size_px, row.kind),
            (Format::Svg, None, AssetKind::Background)
        );
        assert!(repo.asset(Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn the_database_refuses_an_asset_that_could_not_be_one() {
        let Some(repo) = repo().await else { return };
        let base = asset(Entity::WelldIt, AssetKind::Logo);
        let bad = [
            NewAsset {
                bytes: 0,
                ..base.clone()
            },
            NewAsset {
                bytes: 2_097_153,
                ..base.clone()
            },
            NewAsset {
                size_px: None,
                ..base.clone()
            }, // a raster without a size
            NewAsset {
                format: Format::Svg,
                ..base.clone()
            }, // an SVG with one
            NewAsset {
                size_px: Some((0, 10)),
                ..base.clone()
            },
            NewAsset {
                created_by: String::new(),
                ..base.clone()
            },
        ];
        for (n, asset) in bad.into_iter().enumerate() {
            assert!(
                repo.insert_asset(NewAsset {
                    id: Uuid::new_v4(),
                    ..asset
                })
                .await
                .is_err(),
                "case {n}"
            );
        }
        assert_eq!(count(&repo, "letterhead_asset").await, 0);
        // checks on the other columns, raw
        assert!(raw(&repo, "insert into letterhead_asset (id, entity, kind, format, sha256, bytes, created_by) values (gen_random_uuid(), 'welld_de', 'logo', 'svg', '\\x00'::bytea, 1, 'x')").await.is_err());
    }

    #[tokio::test]
    async fn a_version_links_the_assets_it_uses_once_each() {
        let Some(repo) = repo().await else { return };
        let logo = repo
            .insert_asset(asset(Entity::WelldIt, AssetKind::Logo))
            .await
            .unwrap();
        // the same id twice is one link
        repo.save(save(Entity::WelldIt, 0, "a", &[logo.id, logo.id]))
            .await
            .unwrap();
        assert_eq!(
            repo.version_assets(Entity::WelldIt, 1).await.unwrap(),
            vec![logo.clone()]
        );
        assert!(
            repo.version_assets(Entity::WelldIt, 2)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            repo.version_assets(Entity::WelldCh, 1)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn a_version_cannot_use_another_entitys_asset() {
        let Some(repo) = repo().await else { return };
        let foreign = repo
            .insert_asset(asset(Entity::WelldCh, AssetKind::Logo))
            .await
            .unwrap();
        assert!(matches!(
            repo.save(save(Entity::WelldIt, 0, "x", &[foreign.id]))
                .await,
            Err(SaveError::AssetUnavailable)
        ));
        assert_eq!(count(&repo, "letterhead_version").await, 0);
        // and the lookup a save validates with does not show it either
        assert!(
            repo.assets_of_entity(Entity::WelldIt, &[foreign.id])
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            repo.assets_of_entity(Entity::WelldCh, &[foreign.id])
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn the_sweep_deletes_old_unused_uploads_and_only_those() {
        let Some(repo) = repo().await else { return };
        let used = repo
            .insert_asset(asset(Entity::WelldIt, AssetKind::Logo))
            .await
            .unwrap();
        let unused = repo
            .insert_asset(asset(Entity::WelldIt, AssetKind::Logo))
            .await
            .unwrap();
        repo.save(save(Entity::WelldIt, 0, "a", &[used.id]))
            .await
            .unwrap();

        // nothing is older than a day
        assert!(
            repo.sweep_unreferenced_assets(86_400.0)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(repo.asset(unused.id).await.unwrap().is_some());

        // everything is older than now: the unused one goes, the used one stays
        assert_eq!(
            repo.sweep_unreferenced_assets(0.0).await.unwrap(),
            vec![unused.id]
        );
        assert!(repo.asset(unused.id).await.unwrap().is_none());
        assert!(repo.asset(used.id).await.unwrap().is_some());
        assert!(
            repo.sweep_unreferenced_assets(0.0)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn a_save_naming_a_swept_asset_fails_instead_of_keeping_a_version_with_a_missing_logo() {
        let Some(repo) = repo().await else { return };
        let logo = repo
            .insert_asset(asset(Entity::WelldIt, AssetKind::Logo))
            .await
            .unwrap();
        assert_eq!(
            repo.sweep_unreferenced_assets(0.0).await.unwrap(),
            vec![logo.id]
        );
        assert!(matches!(
            repo.save(save(Entity::WelldIt, 0, "x", &[logo.id])).await,
            Err(SaveError::AssetUnavailable)
        ));
        assert_eq!(count(&repo, "letterhead_version").await, 0);
    }

    #[tokio::test]
    async fn a_sweep_and_a_save_racing_for_an_asset_never_leave_a_version_without_it() {
        let Some(repo) = repo().await else { return };
        for round in 0..10 {
            let logo = repo
                .insert_asset(asset(Entity::WelldIt, AssetKind::Logo))
                .await
                .unwrap();
            let base = repo
                .active_version(Entity::WelldIt)
                .await
                .unwrap()
                .map_or(0, |v| v.version);
            let saver = {
                let repo = repo.clone();
                tokio::spawn(async move {
                    repo.save(save(Entity::WelldIt, base, "race", &[logo.id]))
                        .await
                })
            };
            let sweeper = {
                let repo = repo.clone();
                tokio::spawn(async move { repo.sweep_unreferenced_assets(0.0).await })
            };
            let saved = saver.await.unwrap();
            sweeper.await.unwrap().unwrap();
            match saved {
                Ok(version) => {
                    // the version holds, and so does its logo
                    let linked = repo.version_assets(Entity::WelldIt, version).await.unwrap();
                    assert_eq!(linked.len(), 1, "round {round}");
                    assert!(
                        repo.asset(logo.id).await.unwrap().is_some(),
                        "round {round}"
                    );
                }
                Err(SaveError::AssetUnavailable) => {
                    assert!(
                        repo.asset(logo.id).await.unwrap().is_none(),
                        "round {round}"
                    );
                }
                Err(other) => panic!("round {round}: {other:?}"),
            }
        }
    }
}

mod immutability_support {
    use super::*;

    /// A version with a logo, restored once: rows in all four tables.
    pub async fn populated(repo: &Repo) -> (Uuid, Uuid) {
        let used = repo
            .insert_asset(asset(Entity::WelldIt, AssetKind::Logo))
            .await
            .unwrap();
        let unused = repo
            .insert_asset(asset(Entity::WelldIt, AssetKind::Background))
            .await
            .unwrap();
        repo.save(save(Entity::WelldIt, 0, "v1", &[used.id]))
            .await
            .unwrap();
        repo.restore(restore(Entity::WelldIt, 1, 1)).await.unwrap();
        (used.id, unused.id)
    }
}

mod immutability {
    use super::immutability_support::populated;
    use super::*;

    #[tokio::test]
    async fn a_raw_update_or_delete_of_a_version_is_refused() {
        let Some(repo) = repo().await else { return };
        populated(&repo).await;
        let before = repo.version(Entity::WelldIt, 1).await.unwrap().unwrap();
        refused_as_immutable(
            raw(
                &repo,
                "update letterhead_version set config = '{}'::jsonb where version = 1",
            )
            .await,
            "update version config",
        );
        refused_as_immutable(
            raw(&repo, "update letterhead_version set layout_version = 9").await,
            "update version layout",
        );
        refused_as_immutable(
            raw(
                &repo,
                "update letterhead_version set created_by = 'someone else'",
            )
            .await,
            "update version author",
        );
        refused_as_immutable(
            raw(&repo, "delete from letterhead_version where version = 1").await,
            "delete version",
        );
        refused_as_immutable(
            raw(&repo, "delete from letterhead_version").await,
            "delete every version",
        );
        assert_eq!(
            repo.version(Entity::WelldIt, 1).await.unwrap().unwrap(),
            before
        );
        assert_eq!(count(&repo, "letterhead_version").await, 2);
    }

    #[tokio::test]
    async fn a_raw_update_or_delete_of_an_asset_link_is_refused() {
        let Some(repo) = repo().await else { return };
        populated(&repo).await;
        refused_as_immutable(
            raw(
                &repo,
                "update letterhead_version_asset set version = 2 where version = 1",
            )
            .await,
            "update link",
        );
        refused_as_immutable(
            raw(
                &repo,
                "delete from letterhead_version_asset where version = 1",
            )
            .await,
            "delete link",
        );
        refused_as_immutable(
            raw(&repo, "delete from letterhead_version_asset").await,
            "delete every link",
        );
        assert_eq!(count(&repo, "letterhead_version_asset").await, 2);
    }

    #[tokio::test]
    async fn a_raw_update_or_delete_of_an_asset_that_a_version_uses_is_refused() {
        let Some(repo) = repo().await else { return };
        let (used, _) = populated(&repo).await;
        refused_as_immutable(
            raw(
                &repo,
                "update letterhead_asset set bytes = 1 where kind = 'logo'",
            )
            .await,
            "update used asset",
        );
        refused_as_immutable(
            raw(&repo, "update letterhead_asset set sha256 = '\\x00'::bytea").await,
            "update every asset",
        );
        refused_as_immutable(
            raw(&repo, "delete from letterhead_asset where kind = 'logo'").await,
            "delete used asset",
        );
        assert_eq!(repo.asset(used).await.unwrap().unwrap().bytes, 1234);
    }

    #[tokio::test]
    async fn a_raw_update_or_delete_of_a_change_row_is_refused() {
        let Some(repo) = repo().await else { return };
        populated(&repo).await;
        refused_as_immutable(
            raw(
                &repo,
                "update letterhead_change set actor_name = 'someone else'",
            )
            .await,
            "update change",
        );
        refused_as_immutable(
            raw(
                &repo,
                "update letterhead_change set changed_settings = '{}'",
            )
            .await,
            "update change settings",
        );
        refused_as_immutable(
            raw(&repo, "delete from letterhead_change where version = 1").await,
            "delete change",
        );
        refused_as_immutable(
            raw(&repo, "delete from letterhead_change").await,
            "delete every change",
        );
        assert_eq!(count(&repo, "letterhead_change").await, 2);
        let history = repo.history(Entity::WelldIt).await.unwrap();
        assert_eq!(history[1].actor_name, "Ada Lovelace");
    }

    #[tokio::test]
    async fn an_unused_asset_cannot_be_updated_but_can_be_deleted() {
        let Some(repo) = repo().await else { return };
        let (_, unused) = populated(&repo).await;
        refused_as_immutable(
            raw(
                &repo,
                "update letterhead_asset set bytes = 1 where kind = 'background'",
            )
            .await,
            "update unused asset",
        );
        assert_eq!(repo.asset(unused).await.unwrap().unwrap().bytes, 1234);
        assert_eq!(
            raw(
                &repo,
                "delete from letterhead_asset where kind = 'background'"
            )
            .await
            .unwrap(),
            1
        );
        assert!(repo.asset(unused).await.unwrap().is_none());
        // the one a version uses is still there
        assert_eq!(count(&repo, "letterhead_asset").await, 1);
    }

    #[tokio::test]
    async fn the_foreign_keys_restrict_and_never_cascade() {
        let Some(repo) = repo().await else { return };
        populated(&repo).await;
        // Even with the triggers out of the way, a parent that is used cannot go: that is the keys' own job.
        let mut tx = pool(&repo).begin().await.unwrap();
        tx.execute("alter table letterhead_version disable trigger letterhead_version_immutable")
            .await
            .unwrap();
        tx.execute("alter table letterhead_version_asset disable trigger letterhead_version_asset_immutable").await.unwrap();
        tx.execute("alter table letterhead_change disable trigger letterhead_change_immutable")
            .await
            .unwrap();
        assert!(
            tx.execute("delete from letterhead_version where version = 2")
                .await
                .is_err(),
            "a change row refers to it"
        );
        drop(tx); // rolled back: the triggers are on again
        let mut tx = pool(&repo).begin().await.unwrap();
        tx.execute("alter table letterhead_asset disable trigger letterhead_asset_guard")
            .await
            .unwrap();
        assert!(
            tx.execute("delete from letterhead_asset where kind = 'logo'")
                .await
                .is_err(),
            "a version refers to it"
        );
        drop(tx);
        assert_eq!(count(&repo, "letterhead_version").await, 2);
        assert_eq!(count(&repo, "letterhead_asset").await, 2);
    }

    #[tokio::test]
    async fn the_triggers_are_there_and_name_themselves() {
        let Some(repo) = repo().await else { return };
        let names: Vec<String> = sqlx::query_scalar(
            "select tgname::text from pg_trigger t join pg_class c on c.oid = t.tgrelid \
             where not t.tgisinternal and c.relname like 'letterhead_%' and c.relnamespace = current_schema()::regnamespace order by 1",
        )
        .fetch_all(pool(&repo))
        .await
        .unwrap();
        assert_eq!(
            names,
            [
                "letterhead_asset_guard",
                "letterhead_asset_no_truncate",
                "letterhead_change_immutable",
                "letterhead_change_no_truncate",
                "letterhead_version_asset_immutable",
                "letterhead_version_asset_no_truncate",
                "letterhead_version_immutable",
                "letterhead_version_no_truncate"
            ]
        );
    }

    #[tokio::test]
    async fn the_schema_rejects_what_a_version_cannot_be() {
        let Some(repo) = repo().await else { return };
        repo.save(save(Entity::WelldIt, 0, "a", &[])).await.unwrap();
        for statement in [
            "insert into letterhead_version (entity, version, layout_version, config, created_by) values ('welld_de', 1, 1, '{}', 'x')",
            "insert into letterhead_version (entity, version, layout_version, config, created_by) values ('welld_it', 0, 1, '{}', 'x')",
            "insert into letterhead_version (entity, version, layout_version, config, created_by) values ('welld_it', 5, 0, '{}', 'x')",
            "insert into letterhead_version (entity, version, layout_version, config, created_by) values ('welld_it', 5, 1, '[]', 'x')",
            "insert into letterhead_version (entity, version, layout_version, config, created_by) values ('welld_it', 1, 1, '{}', 'x')",
            "insert into letterhead_version (entity, version, layout_version, config, created_by, restored_from) values ('welld_it', 2, 1, '{}', 'x', 2)",
            "insert into letterhead_version (entity, version, layout_version, config, created_by, restored_from) values ('welld_it', 2, 1, '{}', 'x', 7)",
            "insert into letterhead_change (entity, version, action, actor_sub, actor_name, changed_settings) values ('welld_it', 1, 'save', 'x', 'x', '{}')",
            "insert into letterhead_change (entity, version, action, actor_sub, actor_name, changed_settings) values ('welld_it', 9, 'save', 'x', 'x', '{}')",
            "insert into letterhead_change (entity, version, action, actor_sub, actor_name, changed_settings, restored_from) values ('welld_it', 1, 'save', 'x', 'x', '{}', 1)",
            "insert into letterhead_change (entity, version, action, actor_sub, actor_name, changed_settings) values ('welld_it', 1, 'erase', 'x', 'x', '{}')",
        ] {
            assert!(raw(&repo, statement).await.is_err(), "{statement}");
        }
        assert_eq!(count(&repo, "letterhead_version").await, 1);
        assert_eq!(count(&repo, "letterhead_change").await, 1);
    }
}

/// TRUNCATE is neither an UPDATE nor a DELETE, so the row triggers never see it: the statement-level triggers of
/// the migration `20261117000001_refuse_truncate` do (amendment 2026-11-17, item 5; AC-4.6, AC-4.7).
mod truncate {
    use super::immutability_support::populated;
    use super::*;

    const TABLES: [&str; 4] = [
        "letterhead_asset",
        "letterhead_version",
        "letterhead_version_asset",
        "letterhead_change",
    ];

    async fn counts(repo: &Repo) -> Vec<i64> {
        let mut counts = Vec::new();
        for table in TABLES {
            counts.push(count(repo, table).await);
        }
        counts
    }

    /// The tables that a foreign key points at: Postgres refuses a plain TRUNCATE of these by itself, before
    /// any trigger could fire. The other two (the asset links and the change record) have only the trigger.
    const REFERENCED: [&str; 2] = ["letterhead_asset", "letterhead_version"];

    async fn run(repo: &Repo, statement: &str) -> Result<u64, sqlx::Error> {
        // `statement` is one of this module's own literals.
        sqlx::query(sqlx::AssertSqlSafe(statement.to_owned()))
            .execute(pool(repo))
            .await
            .map(|r| r.rows_affected())
    }

    /// Refused by the trigger of the migration.
    async fn refused(repo: &Repo, statement: &str) {
        refused_as_immutable(run(repo, statement).await, statement);
    }

    #[tokio::test]
    async fn truncating_each_table_alone_is_refused_and_every_row_is_still_there() {
        let Some(repo) = repo().await else { return };
        populated(&repo).await;
        let before = counts(&repo).await;
        assert!(
            before.iter().all(|n| *n > 0),
            "rows in all four: {before:?}"
        );
        for table in TABLES {
            for statement in [
                format!("truncate {table}"),
                format!("truncate table only {table} restart identity"),
            ] {
                if REFERENCED.contains(&table) {
                    // Refused by the foreign key first; what matters is that it is refused.
                    assert!(run(&repo, &statement).await.is_err(), "{statement}");
                } else {
                    refused(&repo, &statement).await;
                }
            }
        }
        assert_eq!(counts(&repo).await, before);
    }

    #[tokio::test]
    async fn truncate_cascade_from_any_table_is_refused_too() {
        let Some(repo) = repo().await else { return };
        populated(&repo).await;
        let before = counts(&repo).await;
        for table in TABLES {
            refused(&repo, &format!("truncate {table} cascade")).await;
        }
        // Together, as a script or a test reset might write it.
        refused(
            &repo,
            &format!("truncate {} restart identity", TABLES.join(", ")),
        )
        .await;
        assert_eq!(counts(&repo).await, before);
    }

    #[tokio::test]
    async fn the_refusal_names_the_table_and_no_row() {
        let Some(repo) = repo().await else { return };
        populated(&repo).await;
        match raw(&repo, "truncate letterhead_change").await {
            Err(sqlx::Error::Database(e)) => {
                assert!(
                    e.message().starts_with("letterhead_immutable"),
                    "{}",
                    e.message()
                );
                assert!(e.message().contains("letterhead_change"), "{}", e.message());
                assert!(!e.message().contains("v1"), "no content: {}", e.message());
            }
            other => panic!("expected the trigger to refuse, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn an_empty_table_is_refused_too_and_the_repository_works_after_a_refusal() {
        let Some(repo) = repo().await else { return };
        refused(&repo, "truncate letterhead_change").await;
        refused(&repo, "truncate letterhead_version cascade").await;
        repo.save(save(Entity::WelldIt, 0, "a", &[])).await.unwrap();
        refused(&repo, "truncate letterhead_version_asset").await;
        refused(&repo, "truncate letterhead_version cascade").await;
        assert_eq!(count(&repo, "letterhead_version").await, 1);
        assert_eq!(count(&repo, "letterhead_change").await, 1);
    }
}

mod the_layer_itself {
    use super::*;

    #[tokio::test]
    async fn connecting_fails_fast_without_a_database_and_works_with_one() {
        // nothing listens on port 1
        let started = std::time::Instant::now();
        assert!(
            Repo::connect("postgres://postgres:x@127.0.0.1:1/none", 1)
                .await
                .is_err()
        );
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
        let Ok(url) = std::env::var(URL_VAR) else {
            return;
        };
        Repo::connect(&url, 1).await.expect("connect");
    }

    #[test]
    fn a_save_error_says_what_happened_without_a_row() {
        assert_eq!(
            SaveError::VersionConflict { current: 4 }.to_string(),
            "another version was saved: the newest is 4"
        );
        assert!(
            SaveError::Db(sqlx::Error::PoolClosed)
                .to_string()
                .starts_with("database error")
        );
    }

    /// The migration is the first line of defence at the data; this file is the first line at the code: it has
    /// no statement that changes what is permanent (AC-4.3, 4.6).
    #[test]
    fn no_function_changes_what_is_permanent() {
        let source = include_str!("repo.rs");
        let statements = source.to_lowercase();
        assert!(
            !statements.contains("update letterhead_"),
            "an update statement"
        );
        assert!(!statements.contains("truncate"));
        assert!(!statements.contains("drop table"));
        let mut deletes = statements
            .match_indices("delete from")
            .map(|(at, _)| &statements[at..]);
        assert_eq!(
            deletes
                .next()
                .map(|s| s.starts_with("delete from letterhead_asset where id")),
            Some(true)
        );
        assert!(deletes.next().is_none(), "the sweep is the only delete");
    }

    #[tokio::test]
    async fn migrate_says_how_many_it_applied_and_a_second_run_applies_none() {
        let Some(repo) = unmigrated().await else {
            return;
        };
        let embedded = repo.pending_migrations().await.unwrap();
        assert!(
            embedded >= 2,
            "the init migration and the guard: {embedded}"
        );
        assert_eq!(repo.migrate().await.unwrap(), embedded);
        assert_eq!(repo.pending_migrations().await.unwrap(), 0);
        assert_eq!(repo.migrate().await.unwrap(), 0, "a re-run is a no-op");
        assert_eq!(repo.migrate().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn migrating_twice_is_harmless() {
        let Some(repo) = repo().await else { return };
        repo.migrate().await.unwrap();
        repo.migrate().await.unwrap();
        repo.save(save(Entity::WelldIt, 0, "a", &[])).await.unwrap();
        repo.migrate().await.unwrap();
        assert_eq!(count(&repo, "letterhead_version").await, 1);
    }

    #[tokio::test]
    async fn a_row_reads_back_what_a_person_saved_exactly() {
        let Some(repo) = repo().await else { return };
        let odd = json!({
            "texts": ["{legal_name}", "[VAT: {vat}]", "{{x}}", "日本語 😀 \u{0}".replace('\u{0}', "")],
            "numbers": [25, 25.4, 0.5, 1e-3],
            "nested": { "a": [], "b": {}, "c": null }
        });
        let mut input = save(Entity::WelldIt, 0, "x", &[]);
        input.config = odd.clone();
        repo.save(input).await.unwrap();
        assert_eq!(
            repo.version(Entity::WelldIt, 1)
                .await
                .unwrap()
                .unwrap()
                .config,
            odd
        );
    }
}

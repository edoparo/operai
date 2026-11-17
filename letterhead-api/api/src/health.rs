//! `GET /health` — liveness of the process.
//!
//! It touches nothing outside the process (no database, no bucket, no worker): it answers whether the
//! supervisor is up and its environment was accepted. Readiness checks of the database and the pool come
//! with the tasks that add them. It carries no version: releases are versioned by Changesets, not by Cargo.

use axum::{Json, Router, routing::get};
use serde_json::{Value, json};

pub fn router() -> Router {
    Router::new().route("/health", get(health))
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "letterhead-api" }))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn health_answers_200_with_the_service_name() {
        let response = router()
            .oneshot(
                Request::get("/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 1024).await.expect("body");
        let json: Value = serde_json::from_slice(&body).expect("json");
        assert_eq!(json, json!({ "status": "ok", "service": "letterhead-api" }));
    }
}

//! What a resolved grant covers: the Rust port of `crm-api/src/authz/conditions.ts` (task T14; AC-8.2, plan R3).
//!
//! Same rules, same names, and one table of cases that both run: `docs/fixtures/entity-scope.json` (this file's
//! test below, and `crm-api/src/authz/conditions.scope-fixture.test.ts` for the TypeScript original). A rule
//! changed in one place and not the other fails a test.
//!
//! - [`has_capability`]: does the resolved set hold the `(resource, action)` pair at all?
//! - [`scope_for`]: which entities does that pair cover for this caller?
//! - [`in_scope`]: is a record's entity inside such a set?
//!
//! The scope **fails closed**, as the original does: a condition that is not understood contributes nothing to
//! the scope; it never widens it. Only two things widen: no condition at all (both entities, "an administrator",
//! AC-8.2), and `{ key: "entity", match: "user" }`, which narrows to the caller's own entity.
//!
//! One deliberate difference, in the direction of closed: `conditions` that is neither `null` nor an object
//! (a string, a number, an array, or no `conditions` member at all) is a grant that is not understood here. The
//! TypeScript reads such a value as "no condition" or throws on it. `auth` never sends one, so the table does not
//! hold a case for it and the two agree on everything `auth` can say.

use letterhead_engine::content::Entity;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// The entities in the order that scope lists have (the original's `ENTITIES`).
pub const ENTITIES: [Entity; 2] = [Entity::WelldCh, Entity::WelldIt];

/// The conditions of one resolved grant, as `auth` sent them.
#[derive(Debug, Clone, Default)]
pub enum Conditions {
    /// `null`: the grant has no condition at all.
    Unconditioned,
    /// An object. A member is `None` when it is absent and `Some(Value::Null)` when it is `null`: the original
    /// tells the two apart (`ownership === undefined`), so this does.
    Object {
        ownership: Option<Value>,
        attributes: Option<Value>,
    },
    /// Anything else, or no `conditions` member.
    #[default]
    Unreadable,
}

fn conditions_of<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Conditions, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Null => Conditions::Unconditioned,
        Value::Object(members) => Conditions::Object {
            ownership: members.get("ownership").cloned(),
            attributes: members.get("attributes").cloned(),
        },
        _ => Conditions::Unreadable,
    })
}

/// One resolved `(resource, action)` grant of `GET /authz/resolve`.
#[derive(Debug, Clone, Deserialize)]
pub struct Permission {
    pub resource: String,
    pub action: String,
    #[serde(default, deserialize_with = "conditions_of")]
    pub conditions: Conditions,
}

fn is_pair(permission: &Permission, resource: &str, action: &str) -> bool {
    permission.resource == resource && permission.action == action
}

/// Whether the set holds a grant for `(resource, action)` at all, whatever conditions it has. A missing
/// capability is a wholesale 403.
pub fn has_capability(permissions: &[Permission], resource: &str, action: &str) -> bool {
    permissions.iter().any(|p| is_pair(p, resource, action))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GrantKind {
    /// No conditions at all.
    Unrestricted,
    /// Every condition is `{ key: "entity", match: "user" }`: the caller's own entity.
    Entity,
    /// Anything else: another attribute, another match, an `ownership`, or the entity condition next to one.
    Unrecognised,
}

fn is_entity_attribute(attribute: &Value) -> bool {
    attribute.get("key").and_then(Value::as_str) == Some("entity")
        && attribute.get("match").and_then(Value::as_str) == Some("user")
}

fn grant_kind(conditions: &Conditions) -> GrantKind {
    let Conditions::Object {
        ownership,
        attributes,
    } = conditions
    else {
        return match conditions {
            Conditions::Unconditioned => GrantKind::Unrestricted,
            _ => GrantKind::Unrecognised,
        };
    };
    // `attributes ?? []`: absent and `null` are the same, a list is read, anything else is not understood.
    let listed: &[Value] = match attributes {
        None | Some(Value::Null) => &[],
        Some(Value::Array(list)) => list,
        Some(_) => return GrantKind::Unrecognised,
    };
    if ownership.is_none() && listed.is_empty() {
        return GrantKind::Unrestricted;
    }
    if ownership.is_none() && listed.iter().all(is_entity_attribute) {
        GrantKind::Entity
    } else {
        GrantKind::Unrecognised
    }
}

/// The entities the caller may act on through `(resource, action)`:
///
/// - no such grant: none;
/// - an unconditioned grant: both;
/// - an entity-conditioned grant: the caller's entity; none when the caller has none, or one that is not ours
///   (a data fault that the admin tool should prevent: never "everything");
/// - a grant with a condition that is not understood: nothing from that grant, and one line on stderr that
///   names the capability (ours, a constant) and nothing of the grant.
///
/// Several grants of the same pair are united, the widest wins. The result is in [`ENTITIES`] order, without
/// duplicates.
pub fn scope_for(
    permissions: &[Permission],
    resource: &str,
    action: &str,
    caller_entity: Option<&str>,
) -> Vec<Entity> {
    let mut covered = [false; ENTITIES.len()];
    for permission in permissions.iter().filter(|p| is_pair(p, resource, action)) {
        match grant_kind(&permission.conditions) {
            GrantKind::Unrestricted => return ENTITIES.to_vec(),
            GrantKind::Unrecognised => {
                eprintln!(
                    "authz: ignoring a grant of {resource}:{action} with a condition that is not understood: it contributes no access"
                );
            }
            GrantKind::Entity => {
                if let Some(own) = caller_entity.and_then(Entity::parse)
                    && let Some(at) = ENTITIES.iter().position(|e| *e == own)
                {
                    covered[at] = true;
                }
            }
        }
    }
    ENTITIES
        .into_iter()
        .zip(covered)
        .filter_map(|(entity, held)| held.then_some(entity))
        .collect()
}

/// Whether a record of `entity` falls inside `scope` (the result of [`scope_for`]). A name that is not one of
/// ours is in no scope.
pub fn in_scope(entity: &str, scope: &[Entity]) -> bool {
    scope.iter().any(|e| e.as_str() == entity)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// The table that crm-api runs too (plan R3).
    const FIXTURE: &str = include_str!("../../../../docs/fixtures/entity-scope.json");

    #[derive(Deserialize)]
    struct Fixture {
        entities: Vec<String>,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        name: String,
        resource: String,
        action: String,
        caller_entity: Option<String>,
        permissions: Vec<Permission>,
        has_capability: bool,
        scope: Vec<String>,
    }

    fn fixture() -> Fixture {
        serde_json::from_str(FIXTURE).expect("docs/fixtures/entity-scope.json is the table")
    }

    #[test]
    fn read_scope_fixture_is_not_empty_and_names_the_entities_in_our_order() {
        let table = fixture();
        assert!(table.cases.len() >= 30, "{} cases", table.cases.len());
        let ours: Vec<&str> = ENTITIES.iter().map(|e| e.as_str()).collect();
        assert_eq!(table.entities, ours);
        let mut names: Vec<&str> = table.cases.iter().map(|c| c.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), table.cases.len(), "case names are unique");
    }

    #[test]
    fn read_scope_fixture_every_case_holds() {
        let table = fixture();
        let mut failures = Vec::new();
        for case in &table.cases {
            let held = has_capability(&case.permissions, &case.resource, &case.action);
            let scope = scope_for(
                &case.permissions,
                &case.resource,
                &case.action,
                case.caller_entity.as_deref(),
            );
            let names: Vec<&str> = scope.iter().map(|e| e.as_str()).collect();
            if held != case.has_capability || names != case.scope {
                failures.push(format!(
                    "{}: capability {held} (want {}), scope {names:?} (want {:?})",
                    case.name, case.has_capability, case.scope
                ));
            }
            // inScope agrees with the scope for every entity and for names that are never in one.
            for entity in &table.entities {
                assert_eq!(
                    in_scope(entity, &scope),
                    case.scope.contains(entity),
                    "{}: in_scope({entity})",
                    case.name
                );
            }
            for stranger in ["welld_de", "WELLD_IT", "", " welld_it"] {
                assert!(!in_scope(stranger, &scope), "{}: {stranger:?}", case.name);
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    fn permission(conditions: Value) -> Permission {
        serde_json::from_value(
            json!({ "resource": "letterhead", "action": "manage", "conditions": conditions }),
        )
        .expect("a permission")
    }

    fn scope_of(permissions: &[Permission], entity: Option<&str>) -> Vec<&'static str> {
        scope_for(permissions, "letterhead", "manage", entity)
            .iter()
            .map(|e| e.as_str())
            .collect()
    }

    #[test]
    fn a_grant_with_conditions_that_are_not_an_object_gives_nothing() {
        // The one place that is closed where the original is open or throws (see the module's note).
        for conditions in [json!("none"), json!(7), json!([]), json!(true)] {
            let grant = permission(conditions.clone());
            assert!(matches!(grant.conditions, Conditions::Unreadable));
            assert_eq!(
                scope_of(&[grant], Some("welld_it")),
                Vec::<&str>::new(),
                "{conditions}"
            );
        }
        // No `conditions` member at all.
        let bare: Permission =
            serde_json::from_value(json!({ "resource": "letterhead", "action": "manage" }))
                .expect("a permission");
        assert_eq!(scope_of(&[bare], Some("welld_it")), Vec::<&str>::new());
    }

    #[test]
    fn a_non_list_attributes_member_is_not_understood() {
        let grant = permission(json!({ "attributes": "entity" }));
        assert_eq!(scope_of(&[grant], Some("welld_it")), Vec::<&str>::new());
        let grant = permission(json!({ "attributes": [null] }));
        assert_eq!(scope_of(&[grant], Some("welld_it")), Vec::<&str>::new());
    }

    #[test]
    fn a_permission_without_a_resource_or_action_is_not_a_response_we_read() {
        assert!(serde_json::from_value::<Permission>(json!({ "action": "manage" })).is_err());
        assert!(
            serde_json::from_value::<Permission>(json!({ "resource": 1, "action": "x" })).is_err()
        );
    }
}

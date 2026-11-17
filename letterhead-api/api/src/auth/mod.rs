//! Who may call. `service` is the credential of the render routes (T12); `person` is the credential of the
//! configurator's routes (T14), and `crate::authz` is what a person may do.

pub mod person;
pub mod service;

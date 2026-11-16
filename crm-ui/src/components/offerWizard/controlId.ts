/** The id of a wizard control and its `data-wizard-field` target: a name holds `:` and `#`, which a selector cannot take. */
export const controlId = (name: string): string => `wiz-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`

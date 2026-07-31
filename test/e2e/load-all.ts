/**
 * Node 24 directory entrypoint: import all e2e suites when `node --test test/e2e/` loads package main.
 */
import './validate-cli.test.ts'
import './run-cli.test.ts'
import './gate-cli.test.ts'

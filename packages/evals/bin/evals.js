#!/usr/bin/env node
import { runEvalsCli } from '../src/cli-evals.ts'

process.exitCode = runEvalsCli(process.argv.slice(2))

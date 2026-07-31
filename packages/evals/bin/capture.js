#!/usr/bin/env node
import { runCaptureCli } from '../src/cli-capture.ts'

process.exitCode = runCaptureCli(process.argv.slice(2))

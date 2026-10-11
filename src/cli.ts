#!/usr/bin/env bun
import { VERSION } from "./index";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(`hone ${VERSION}`);
} else {
  console.log(`hone ${VERSION}  usage: hone [--version]  (commands arrive with later work orders)`);
}

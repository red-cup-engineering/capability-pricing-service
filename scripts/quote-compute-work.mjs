#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { compareComputeWorkOffers } from "../src/compute-work-hiring.mjs";

// Original agent Work is caller-supplied source material. No credential,
// network, order or payment operation is performed by this research command.
const document = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(compareComputeWorkOffers(document), null, 2) + "\n");

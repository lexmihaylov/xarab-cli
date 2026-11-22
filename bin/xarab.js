#!/usr/bin/env node

import { tsImport } from "tsx/esm/api";

await tsImport("../src/tiered/entry.jsx", import.meta.url);

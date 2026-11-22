#!/usr/bin/env node

import { tsImport } from "tsx/esm/api";

await tsImport("../src/single/entry.jsx", import.meta.url);

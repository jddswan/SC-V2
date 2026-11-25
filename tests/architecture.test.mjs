// Garde-fou des règles de dépendance entre couches (voir docs/architecture.md).
// Le domaine reste du JavaScript pur : ni React, ni navigateur, ni couches extérieures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const filesIn = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? filesIn(p) : /\.(m?js|jsx)$/.test(p) ? [p] : [];
}) : []);
const importsOf = (code) => [...code.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);

const RULES = {
  'src/domain': { forbidden: [/^react/, /\/ui\//, /\/application\//, /\/infrastructure\//], noBrowser: true },
  'src/application': { forbidden: [/^react/, /\/ui\//, /\/infrastructure\//], noBrowser: true },
  'src/shared': { forbidden: [/^react/, /\/(ui|application|infrastructure|domain)\//], noBrowser: true },
  'src/brands': { forbidden: [/./], noBrowser: true },
};

for (const [dir, rule] of Object.entries(RULES)) {
  test(`${dir} respecte ses règles de dépendance`, () => {
    for (const file of filesIn(dir)) {
      const code = readFileSync(file, 'utf8');
      for (const imp of importsOf(code)) {
        assert.ok(!rule.forbidden.some((re) => re.test(imp)), `${file} ne doit pas importer « ${imp} »`);
      }
      if (rule.noBrowser) assert.ok(!/\b(window|document|localStorage)\./.test(code), `${file} ne doit pas utiliser le navigateur`);
    }
  });
}

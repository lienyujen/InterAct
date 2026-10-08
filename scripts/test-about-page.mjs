import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')
assert.equal(fs.readFileSync(path.join(root, 'public/about/LICENSE.txt'), 'utf8'), license)
for (const suffix of ['', '/en']) {
  const html = fs.readFileSync(path.join(root, `public/about${suffix}/index.html`), 'utf8')
  assert.ok(html.includes(`href="https://interact.ehuayu.org/about${suffix}"`))
  assert.ok(html.includes('href="https://supabase.com/dashboard"'))
  assert.ok(html.includes('href="/about/about.css"'))
  assert.ok(!html.includes('LingoAct'))
  assert.ok(!html.includes('undefined'))
  for (const anchor of ['features', 'deployment', 'start', 'editions', 'license', 'faq']) assert.ok(html.includes(`id="${anchor}"`))
  assert.ok(html.includes('https://supabase.com/dashboard/account/tokens'))
  assert.ok(html.includes('deployment-steps'))
  assert.ok(html.includes('sb_secret_'))
}
const startup = fs.readFileSync(path.join(root, 'src/routes/PresenterNewPage.tsx'), 'utf8')
assert.ok(startup.includes('href="https://interact.ehuayu.org/about"'))
const setup = fs.readFileSync(path.join(root, 'src/components/BackendSetup.tsx'), 'utf8')
assert.match(setup, /InterAct 使用你自己的 <a href="https:\/\/supabase.com\/dashboard"/)
assert.ok(setup.includes('href="https://interact.ehuayu.org/about/#deployment"'))
console.log('About pages, license, assets and application links verified.')

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pages } from '../docs/about-content.mjs'
import { deploymentGuides } from '../docs/deployment-guide.mjs'
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'public/about')
const license=fs.readFileSync(path.join(root,'LICENSE'),'utf8')
const assetVersion=createHash('sha256').update(fs.readFileSync(path.join(out,'about.css'))).digest('hex').slice(0,12)
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const links=['features','deployment','start','editions','license']
for(const [language,p] of Object.entries(pages)){
 const suffix=language==='en'?'en':language==='zh-CN'?'zh-cn':''
 const dir=path.join(out,suffix),prefix='/about/'
 fs.mkdirSync(dir,{recursive:true})
 const items=(values,render)=>values.map(render).join('\n')
 const guide=deploymentGuides[language]
 const deployment=`<section id="deployment"><p class="section-kicker">DEPLOYMENT / STEP BY STEP</p><h2>${escape(guide.title)}</h2><p class="section-lead">${escape(guide.lead)}</p><p class="note">${escape(guide.prerequisite)}</p><ol class="steps deployment-steps">${items(guide.steps,({title,lines,links=[]},i)=>`<li><span class="step-number">${String(i+1).padStart(2,'0')}</span><div><h3>${escape(title)}</h3><ul>${items(lines,line=>`<li>${escape(line)}</li>`)}</ul>${items(links,([label,url])=>`<a class="guide-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>`)}</div></li>`)}</ol><h3>${escape(guide.troubleshootingTitle)}</h3><div class="faq">${items(guide.troubleshooting,([q,a])=>`<details><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`)}</div></section>`
 const html=`<!doctype html>
<html lang="${language}" id="top"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(p.title)}</title><meta name="description" content="${escape(p.description)}">
<link rel="canonical" href="https://interact.ehuayu.org/about${suffix?'/'+suffix:''}">
<link rel="alternate" hreflang="zh-Hant" href="https://interact.ehuayu.org/about"><link rel="alternate" hreflang="en" href="https://interact.ehuayu.org/about/en">
<meta name="theme-color" content="#6056e9"><meta property="og:title" content="${escape(p.title)}"><meta property="og:description" content="${escape(p.description)}"><meta property="og:type" content="website">
<link rel="stylesheet" href="${prefix}about.css?v=${assetVersion}"><link rel="icon" href="${prefix}mark.svg" type="image/svg+xml">
</head><body>
<header class="header"><a class="brand" href="#top"><img src="${prefix}mark.svg" alt="" width="36" height="36">InterAct</a><nav aria-label="${escape(p.title)}">${items(p.nav,(label,i)=>`<a href="#${links[i]}">${escape(label)}</a>`)}</nav><div class="languages" aria-label="Language">
${items([['zh-TW','繁體',prefix],['en','English',prefix+'en/']],([code,label,href])=>`<a href="${href}" lang="${code}" ${code===language?'aria-current="page"':''}>${label}</a>`)}</div></header>
<main><section class="hero"><div><p class="eyebrow">${escape(p.eyebrow)}</p><h1>${escape(p.hero)}</h1><p class="lead">${escape(p.lead)}</p><div class="actions"><a class="button primary" href="#start">${escape(p.start)} <span aria-hidden="true">↗</span></a><a class="button" href="#license">${escape(p.license)}</a></div><p class="small">${escape(p.tag)}</p></div>
<div class="workflow" aria-label="${escape(p.demo[0])}"><div class="workflow-head"><span class="status-dot"></span>InterAct <small>${escape(p.demo[0])}</small></div><div class="flow-row"><span class="flow-number">01</span><div><strong>${escape(p.demo[1])}</strong><p>${escape(p.demo[2])}<br>${escape(p.demo[3])}</p></div><span class="flow-icon" aria-hidden="true">↗</span></div><div class="flow-row"><span class="flow-number">02</span><div><strong>${escape(p.demo[4])}</strong><p>${escape(p.demo[5])}<br>${escape(p.demo[6])}</p></div><span class="flow-icon" aria-hidden="true">✓</span></div><div class="flow-row"><span class="flow-number">03</span><div><strong>${escape(p.demo[7])}</strong><p>${escape(p.demo[8])}</p></div><span class="flow-icon" aria-hidden="true">↻</span></div></div></section>
<section id="features"><p class="section-kicker">01 / CLASSROOM</p><h2>${escape(p.featureTitle)}</h2><p class="section-lead">${escape(p.featureLead)}</p><div class="feature-grid">${items(p.features,([icon,title,text])=>`<article class="feature"><span class="skill" aria-hidden="true">${escape(icon)}</span><h3>${escape(title)}</h3><p>${escape(text)}</p></article>`)}</div><p class="note">${escape(p.extra)}</p></section>
${deployment}
<section id="start"><p class="section-kicker">02 / GET STARTED</p><h2>${escape(p.setupTitle)}</h2><p class="section-lead">${escape(p.setupLead)}</p><ol class="steps">${items(p.steps,([title,text],i)=>`<li><span class="step-number">${String(i+1).padStart(2,'0')}</span><div><h3>${escape(title)}</h3><p>${escape(text)}</p></div></li>`)}</ol>
<aside class="portable"><div><h3>${escape(p.settingsTitle)}</h3><p>${escape(p.settingsText)}</p><p class="small">${escape(p.settingsKeys)}</p></div><pre><code>VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
VITE_PUBLIC_APP_URL=https://join.ehuayu.org</code></pre></aside><p class="note"><a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">${escape(p.supabaseSignup)}</a> · <a href="https://github.com/lienyujen/InterAct/releases" target="_blank" rel="noopener noreferrer">${escape(p.releases)}</a></p><p class="note">${escape(p.costs)} <a href="https://supabase.com/pricing" target="_blank" rel="noopener noreferrer">Supabase</a> · <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noopener noreferrer">Gemini</a> · <a href="https://openai.com/api/pricing/" target="_blank" rel="noopener noreferrer">OpenAI</a></p></section>
<section id="editions"><p class="section-kicker">03 / EDITIONS</p><h2>${escape(p.versionsTitle)}</h2><p class="section-lead">${escape(p.versionsLead)}</p><div class="editions">${items(p.versions,([title,text])=>`<article><h3>${escape(title)}</h3><p>${escape(text)}</p></article>`)}</div></section>
<section id="license" class="license"><p class="section-kicker">04 / LICENSE</p><h2>${escape(p.licenseTitle)}</h2><p class="section-lead">${escape(p.licenseLead)}</p><div class="license-grid"><article><span class="label">PERSONAL & EDUCATIONAL</span><h3>${escape(p.freeTitle)}</h3><p>${escape(p.freeText)}</p></article><article><span class="label">COMMERCIAL</span><h3>${escape(p.paidTitle)}</h3><p>${escape(p.paidText)}</p></article></div><p>${escape(p.receipt)}</p><div class="actions"><a class="button primary" href="https://www.paypal.com/paypalme/lienyujen" target="_blank" rel="noopener noreferrer">${escape(p.donate)} ↗</a><a class="button" href="https://www.facebook.com/lienyujen/" target="_blank" rel="noopener noreferrer">${escape(p.contact)}</a></div><p class="small">${escape(p.legalNote)}</p><details class="legal"><summary>${escape(p.legal)} <span>PolyForm Noncommercial 1.0.0</span></summary><a href="${prefix}LICENSE.txt" download>${escape(p.download)} ↓</a><pre>${escape(license)}</pre></details></section>
<section id="faq"><h2>${escape(p.faqTitle)}</h2><div class="faq">${items(p.faq,([q,a])=>`<details><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`)}</div></section>
</main><footer><div class="brand">InterAct</div><p>${escape(p.footer)} <a href="https://www.facebook.com/lienyujen/" target="_blank" rel="noopener noreferrer">Yujen Lien</a></p><p class="small">${escape(p.update)} · <a href="#top">${escape(p.top)} ↑</a></p></footer>
</body></html>`
 fs.writeFileSync(path.join(dir,'index.html'),html)
}
fs.writeFileSync(path.join(out,'LICENSE.txt'),license)
console.log('Public about page generated in Traditional Chinese and English; license copied verbatim.')

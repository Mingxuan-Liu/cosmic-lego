import { coverage } from './coverage.mjs'
import { assetTemplates } from './reuse.mjs'
import { roadmap } from './roadmap.mjs'
import { diagramFor, roadmapGraph, visualsFor } from './roadmap-assets.mjs'
import { foundationFor } from './foundations.mjs'
import { createCluster } from './cluster.js'
import { locateStars } from './layout.js'

const $ = id => document.getElementById(id)
function element(tag, text) {
  const el = document.createElement(tag)
  if (text !== undefined) el.textContent = text
  return el
}
function button(label, click) {
  const el = element('button', label)
  el.type = 'button'
  el.addEventListener('click', click)
  return el
}
const palette = ['#F0CA86','#93CCDB','#B7A3DE','#8DC9AD','#F3A18D','#9CADEB']
const fields = new Map(roadmap.families.map((field,i) => [field.id,{ ...field, color: palette[i] }]))
const templates = new Map(assetTemplates.map(a => [a.id,a]))
const levels = {}
for (const [level,topics] of [['domain',roadmap.domains],['phenomenon',roadmap.phenomena]]) {
  const nodes = topics.map(n => ({ ...n, ...foundationFor(n.id), color: fields.get(n.partId).color }))
  levels[level] = { nodes: locateStars(nodes), graph: roadmapGraph(nodes) }
}
const byId = new Map(Object.values(levels).flatMap(l => l.nodes.map(n => [n.id,n])))
const childrenOf = id => roadmap.phenomena.filter(n => n.parentId === id)
const techniquesByTarget = new Map()
for (const technique of roadmap.phenomena) {
  for (const {id,reason} of technique.applications ?? []) {
    if (!techniquesByTarget.has(id)) techniquesByTarget.set(id,[])
    techniquesByTarget.get(id).push({id:technique.id,reason})
  }
}
const fold = value => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[‐‑‒–—−-]/g,' ').replace(/&/g,' and ').replace(/\s+/g,' ').trim()
const searchIndex = new Map()
for (const n of byId.values()) {
  const assets = visualsFor(n.id).flatMap(a => [diagramFor(a.assetId).label,templates.get(a.assetId).label])
  searchIndex.set(n.id,fold([n.label,n.question,fields.get(n.partId).label,...n.keywords,...assets].join(' ')))
}
for (const n of roadmap.phenomena) {
  searchIndex.set(n.parentId,searchIndex.get(n.parentId)+' '+searchIndex.get(n.id))
  searchIndex.set(n.id,searchIndex.get(n.id)+' '+fold(byId.get(n.parentId).label))
}
for (const f of fields.values()) {
  $('category').add(new Option(f.label,f.id))
  const item = element('span',f.label)
  item.className = 'legend-item'
  item.style.setProperty('--swatch',f.color)
  $('legend').append(item)
}
$('method-source').href = coverage.source.tocUrl
const live = element('span')
live.className = 'sr-only'
live.setAttribute('aria-live','polite')
$('graph-panel').append(live)

let mode = document.documentElement.dataset.projection, level = 'domain', scope = null
let selected = null, selectedEdge = null, visible = [], links = [], degree = new Map()
let sortKey = 'rank', descending = false
const plural = { domain:'domains', phenomenon:'topics' }
const cluster = createCluster($('atlas-canvas'),{
  onNode: showTopic, onEdge: showEdge,
  onZoom: z => { $('zoom-level').textContent = Math.round(z*100)+'%' },
  onRead: n => { live.textContent = n.label+'. '+n.question+' Press Enter to explore.' }
})
function setView(next) {
  mode = next
  $('graph-panel').hidden = mode === 'table'
  $('table-panel').hidden = mode !== 'table'
  for (const [id,view] of [['plan-mode','2d'],['graph-mode','3d'],['table-mode','table']]) {
    $(id).setAttribute('aria-pressed',String(view === mode))
  }
  if (mode === 'table') drawTable()
  else {
    document.documentElement.dataset.projection = mode
    $('atlas-canvas').setAttribute('aria-label',mode === '2d' ? '2D astronomy roadmap' : '3D astronomy cluster')
    cluster.setProjection(mode)
    cluster.redraw()
  }
}
function refresh() {
  const changingLevel = level !== $('level').value
  level = $('level').value
  const data = levels[level], query = fold($('query').value), terms = query.split(' ').filter(Boolean)
  const field = $('category').value, status = $('availability').value
  const inScope = data.nodes.filter(n => (!field || n.partId === field) && (!status || n.availability === status) &&
    (!scope || n.parentId === scope))
  const exact = query ? inScope.filter(n => fold(n.label) === query ||
    (level === 'domain' && childrenOf(n.id).some(child => fold(child.label) === query))) : []
  visible = !query ? inScope : exact.length ? exact : inScope.filter(n => terms.every(term => searchIndex.get(n.id).includes(term)))
  const ids = new Set(visible.map(n => n.id))
  const graph = inScope.length === data.nodes.length ? data.graph : roadmapGraph(inScope)
  links = graph.allEdges
  // Keep the surrounding constellation; give relevant pairs their own overview slots.
  let overview = graph.edges
  if (terms.length && visible.length > 1 && visible.length < inScope.length) {
    const key = e => e.source+'/'+e.target
    const matchedPairs = new Set(roadmapGraph(visible).edges.map(key))
    overview = [...new Set([...overview,...links.filter(e => matchedPairs.has(key(e)))])]
  }
  if (selectedEdge) {
    const replacement = links.find(e => e.source === selectedEdge.source && e.target === selectedEdge.target)
    if (replacement && ids.has(replacement.source) && ids.has(replacement.target)) { selectedEdge = replacement; cluster.select(null,selectedEdge) }
    else closeDetail(false)
  }
  if (selected && !ids.has(selected)) closeDetail(false)
  degree = new Map(inScope.map(n => [n.id,0]))
  for (const e of links) {
    degree.set(e.source,degree.get(e.source)+1)
    degree.set(e.target,degree.get(e.target)+1)
  }
  $('graph-empty').hidden = $('table-empty').hidden = !!visible.length
  for (const reset of document.querySelectorAll('[data-clear-filters]')) {
    reset.dataset.searchOnly = String(!!query && !!inScope.length)
    reset.textContent = reset.dataset.searchOnly === 'true' ? 'Clear search' : 'Clear filters'
  }
  $('scope-chip').hidden = !scope
  if (scope) $('scope-label').textContent = byId.get(scope).label
  const techniquesOnly = level === 'phenomenon' && inScope.length > 0 && inScope.every(n => n.kind === 'technique')
  const peers = techniquesOnly ? data.nodes.filter(n => n.kind === 'technique') : data.nodes
  const denominator = terms.length ? inScope.length : peers.length
  const count = visible.length+' of '+denominator+' '+(techniquesOnly ? 'techniques' : plural[level])
  $('result-count').textContent = terms.length ? count+' · search results' :
    count+' · '+links.length+' diagram '+(links.length===1?'connection':'connections')
  cluster.setData(inScope,overview,links,terms.length ? ids : null)
  if (changingLevel) cluster.fit()
  if (selected) renderTopic(byId.get(selected))
  else if (selectedEdge) renderEdge(selectedEdge)
  if (mode === 'table') drawTable()
}
function badge(n) {
  const status = element('span',n.availability === 'available' ? (n.level === 'domain' ? 'Study available' : 'Available now') : 'Study planned')
  status.className = 'status-badge'
  status.dataset.status = n.availability
  return status
}
const columns = [['label','Name'],['field','Field'],['availability','Interactive study'],['rank','Foundation rank'],['degree','Connected topics']]
function drawTable() {
  const head = element('tr')
  for (const [key,title] of columns) {
    const th = element('th')
    th.scope = 'col'
    const sorted = sortKey === key
    th.setAttribute('aria-sort',sorted ? descending ? 'descending' : 'ascending' : 'none')
    th.append(button(title+(sorted ? descending ? ' ↓' : ' ↑' : ''),() => {
      descending = sortKey === key ? !descending : key === 'degree'
      sortKey = key
      drawTable()
      $('table-head').querySelector('[aria-sort="'+(descending ? 'descending' : 'ascending')+'"] button')?.focus()
    }))
    head.append(th)
  }
  $('table-head').replaceChildren(head)
  const value = n => ({ field:fields.get(n.partId).label, degree:degree.get(n.id) })[sortKey] ?? n[sortKey]
  const rows = [...visible].sort((a,b) => {
    const left = value(a), right = value(b)
    return (typeof left === 'string' ? left.localeCompare(right) : left-right)*(descending ? -1 : 1) || a.order-b.order
  })
  const body = document.createDocumentFragment()
  for (const n of rows) {
    const tr = element('tr')
    tr.classList.toggle('is-selected',selected === n.id || selectedEdge?.source === n.id || selectedEdge?.target === n.id)
    const open = button(n.label,()=>showTopic(n.id))
    open.dataset.topicId = n.id
    const values = [open,fields.get(n.partId).label,badge(n),n.rank+' / '+n.peerCount,String(degree.get(n.id))]
    for (const [i,v] of values.entries()) {
      const td = element('td')
      td.dataset.label = columns[i][1]
      td.append(v)
      tr.append(td)
    }
    body.append(tr)
  }
  $('table-body').replaceChildren(body)
}
function header(type,title,summary) {
  $('detail').hidden = false
  $('detail-type').textContent = type
  $('detail-title').textContent = title
  $('detail-summary').textContent = summary
  $('detail-meta').replaceChildren()
  $('detail-links').replaceChildren()
}
function inspect() {
  $('detail').scrollTop = 0
  $('detail-title').focus({preventScroll:true})
  if (matchMedia('(max-width: 800px)').matches) $('detail').scrollIntoView({block:'start'})
  cluster.select(selected,selectedEdge)
  if (mode === 'table') drawTable()
}
function showTopic(id) {
  selected = id
  selectedEdge = null
  renderTopic(byId.get(id))
  inspect()
}
function showEdge(e) {
  selected = null
  selectedEdge = e
  renderEdge(e)
  inspect()
}
function enterDomain(domain, child) {
  scope = domain.id
  $('level').value = 'phenomenon'
  $('query').value = ''
  if (child && $('availability').value && child.availability !== $('availability').value) $('availability').value = ''
  closeDetail(false)
  refresh()
  if (child) showTopic(child.id)
  else focusResults()
}
// A suggested next topic may lie outside a search or the currently open domain.
function visitTopic(id) {
  const topic = byId.get(id)
  if (!visible.some(n => n.id === id)) {
    $('level').value = topic.level
    if (scope && topic.parentId !== scope) scope = null
    if ($('category').value !== topic.partId) $('category').value = ''
    if ($('availability').value !== topic.availability) $('availability').value = ''
    $('query').value = ''
    refresh()
  }
  showTopic(id)
}
function scoreNote(n) {
  const note = element('details')
  note.className = 'asset-note score-note'
  note.append(element('summary','Why this star is this size'))
  const direct = n.directIds.length, total = n.reachableIds.length
  const unit = n.level === 'domain' ? 'domain' : 'topic'
  const description = total ? 'On this map, '+n.label+' helps explain '+direct+' other '+(direct===1?unit:plural[n.level])+' directly'+
    (direct < total ? ' and '+(total-direct)+' more through those ideas.' : '.') :
    'This is a destination on the learning paths mapped so far.'
  note.append(element('p',description),element('p','Each topic reached counts once. A direct step adds 1 point, two steps add ½, and three steps add ⅓. '+
    'This star has '+Number(n.score.toFixed(2))+' points, ranking '+n.rank+' of '+n.peerCount+' '+plural[n.level]+'.'))
  for (const example of n.examples.slice(0,2)) {
    const explanation = element('p',byId.get(example.from).label+' → '+byId.get(example.to).label+'. '+example.reason)
    if (example.source) {
      const reading = element('a','Read the source')
      reading.href = example.source
      explanation.append(' ',reading)
    }
    note.append(explanation)
  }
  return note
}
function relatedButton(id) {
  const link = button(byId.get(id).label,()=>visitTopic(id))
  link.dataset.relatedId = id
  return link
}
function learningPath(target,n) {
  const featured = new Set([...(n.applications ?? []),...(techniquesByTarget.get(n.id) ?? [])].map(link => link.id))
  const forward = n.directIds.filter(id => !featured.has(id))
  const next = forward.length ? forward : n.prerequisiteIds.filter(id => !featured.has(id))
  if (!next.length) return
  target.append(element('h3',forward.length ? 'Build on this idea' : 'Ideas to start with'))
  for (const id of next.slice(0,3)) target.append(relatedButton(id))
}
function renderTopic(n) {
  const domain = n.level === 'domain', children = domain ? childrenOf(n.id) : []
  const technique = n.kind === 'technique'
  const group = domain ? fields.get(n.partId) : byId.get(n.parentId)
  const type = domain ? (technique ? 'Technique group' : 'Domain') : (technique ? 'Technique' : 'Phenomenon')
  header(group.label+' · '+type,n.label,n.question)
  const meta = $('detail-meta'), target = $('detail-links')
  if (n.insight) {
    const insight = element('p',n.insight)
    insight.className = 'phenomenon-insight'
    meta.append(insight)
  }
  meta.append(badge(n))
  if (domain) {
    const explore = button('Explore '+children.length+(technique?' techniques':' phenomena')+' →',() => enterDomain(n))
    explore.id = 'explore-domain'
    explore.className = 'roadmap-action'
    target.append(explore,element('h3',technique?'Choose a technique':'Choose a phenomenon'))
    for (const child of children) {
      const pick = button(child.label,()=>enterDomain(n,child))
      pick.dataset.phenomenonId = child.id
      pick.title = child.question
      if (child.availability === 'available') pick.append(' · available now')
      target.append(pick)
    }
  } else if (n.launch) {
    const launch = element('a',n.launch.label+' →')
    launch.className = 'roadmap-action study-launch'
    launch.href = n.launch.href
    target.append(launch)
  }
  const applications = n.applications ?? []
  const methods = techniquesByTarget.get(n.id) ?? []
  if (applications.length || methods.length) {
    target.append(element('h3',technique?'What can you study with it?':'How can we study this?'))
    for (const {id,reason} of [...applications,...methods]) {
      const link = relatedButton(id)
      link.dataset[technique?'applicationId':'techniqueId'] = id
      target.append(link,element('p',reason))
    }
  }
  if (n.source) {
    const reading = element('a',n.source.label+' ↗')
    reading.href = n.source.url
    reading.dataset.techniqueSource = ''
    target.append(element('h3','Go deeper'),reading)
  }
  learningPath(target,n)
  target.append(scoreNote(n))
  const assets = visualsFor(n.id)
  if (assets.length) {
    target.append(element('h3','Ways to picture this'))
    for (const {assetId} of assets) {
      const diagram = diagramFor(assetId), note = element('details')
      note.className = 'asset-note'
      note.append(element('summary',diagram.label),element('p',diagram.prompt))
      target.append(note)
    }
  }
  const adjacent = links.filter(e => e.source === n.id || e.target === n.id)
  if (adjacent.length) {
    target.append(element('h3','Compare with another topic'))
    for (const e of adjacent) {
      const peer = byId.get(e.source === n.id ? e.target : e.source)
      const next = button(peer.label,()=>showEdge(e))
      next.dataset.peerId = peer.id
      target.append(next)
    }
  }
}
function renderEdge(e) {
  const a = byId.get(e.source), b = byId.get(e.target), target = $('detail-links')
  const diagrams = e.assetIds.map(diagramFor)
  header('Explore a connection',a.label+' ↔ '+b.label,diagrams.length === 1 ?
    'One diagram can help you explore both topics.' : 'These topics have several ways to picture them in common.')
  for (const diagram of diagrams) {
    target.append(element('h3',diagram.label),element('p',diagram.prompt))
  }
  target.append(element('h3','Two questions to explore'))
  for (const n of [a,b]) target.append(relatedButton(n.id),element('p',n.question))
}
function focusResults() {
  if (mode !== 'table') $('atlas-canvas').focus()
  else ($('table-body').querySelector('button') ?? $('query')).focus()
}
function closeDetail(focus = true) {
  const id = selected ?? selectedEdge?.source
  selected = selectedEdge = null
  $('detail').hidden = true
  cluster.select(null)
  if (mode === 'table') drawTable()
  if (focus) {
    const row = id && mode === 'table' && $('table-body').querySelector('[data-topic-id="'+id+'"]')
    if (row) row.focus()
    else focusResults()
  }
}
$('level').onchange = $('category').onchange = () => { scope = null; refresh() }
$('availability').onchange = refresh
$('query').oninput = refresh
$('plan-mode').onclick = ()=>setView('2d')
$('graph-mode').onclick = ()=>setView('3d')
$('table-mode').onclick = ()=>setView('table')
$('zoom-in').onclick = ()=>cluster.scale(1.25)
$('zoom-out').onclick = ()=>cluster.scale(1/1.25)
$('fit').onclick = cluster.fit
const turn = Math.PI/12
for (const [direction,yaw,pitch] of [['left',-turn,0],['right',turn,0],['up',0,turn],['down',0,-turn]]) {
  $('orbit-'+direction).onclick = () => cluster.orbit(yaw,pitch)
}
$('scope-clear').onclick = ()=>{ scope=null; refresh(); focusResults() }
$('detail-close').onclick = ()=>closeDetail()
document.addEventListener('keydown',e => {
  if (e.key === 'Escape' && !$('detail').hidden) closeDetail()
})
for (const clear of document.querySelectorAll('[data-clear-filters]')) {
  clear.onclick = () => {
    $('query').value = ''
    if (clear.dataset.searchOnly !== 'true') {
      $('category').value = ''
      $('availability').value = ''
      scope = null
    }
    refresh()
    focusResults()
  }
}
setView(mode)
const returning = byId.get(new URLSearchParams(location.search).get('phenomenon'))
if (returning?.level === 'phenomenon') {
  $('level').value = 'phenomenon'
  scope = returning.parentId
}
refresh()
if (returning?.level === 'phenomenon') showTopic(returning.id)

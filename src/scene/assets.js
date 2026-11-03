import { copyData } from '../core/data.js';
import { descriptorOf } from '../dataflow/index.js';
import { canonical, dataBytes, insist } from './contracts.js';

async function contentHash(data) {
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(data)));
  return `sha256:${[...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

// Local finite geometry/material/RGBA data only. There is no URL, path, shader,
// download, or source-code resolver on this data boundary.
export async function resolveAssets(project, binding, graph, limits, { results, time }) {
  const manifests = new Map(binding.visuals.map(record => [record.manifest.id, record.manifest]));
  const assetNodes = graph.nodes.filter(node => {
    const artifact = manifests.get(node.type)?.artifact;
    return artifact && ['cosmic.geometry.v1', 'cosmic.material.v1', 'cosmic.texture.v1'].includes(artifact.format);
  });
  insist(assetNodes.length <= limits.maxAssets, 'ASSET_BUDGET', 'Too many local assets.');
  const pending = new Map(assetNodes.map(node => [node.id, node])), resolved = new Map();
  let totalBytes = 0;
  async function resolve(id) {
    if (resolved.has(id)) return resolved.get(id);
    const node = pending.get(id);
    insist(node, 'ASSET_MISSING', `Missing local asset ${id}.`, id);
    const dependencies = Object.entries(node.references).filter(([slot]) => slot.startsWith('asset.')).map(([, id]) => id);
    const childAssets = [];
    for (const child of dependencies) childAssets.push(await resolve(child));
    const result = binding.produce(project, id, { results, time });
    if (!result.valid) {
      const error = result.diagnostics.find(item => item.severity !== 'warning') ?? result.diagnostics[0];
      insist(false, error.code, error.message, error.path);
    }
    const data = copyData(result.artifact.data), manifest = manifests.get(node.type);
    const kind = manifest.artifact.format === 'cosmic.texture.v1' ? 'texture' : manifest.artifact.kind;
    const { provenance, ...content } = data;
    const hashContent = { ...content };
    if (kind === 'material' && content.texture) hashContent.texture = childAssets.find(asset => asset.id === content.texture)?.contentId;
    insist(!Object.values(hashContent).includes(undefined), 'ASSET_MISSING', 'A material references an unresolved texture.');
    const asset = { id, kind, contentId: await contentHash({ kind, content: hashContent, dependencies: childAssets.map(asset => asset.contentId) }),
      data, dependencies, provenance: provenance ?? result.artifact.provenance,
      scientificInputs: Object.entries(node.data.inputs).map(([slot, declaration]) => {
        const source = results.find(result => result.producer.nodeId === node.references[`input.${slot}`] && result.producer.port === declaration.port);
        return { nodeId: source.producer.nodeId, port: source.producer.port, implementation: source.producer.implementation, ...descriptorOf(source.value) };
      }) };
    totalBytes += dataBytes(asset);
    insist(totalBytes <= limits.maxAssetBytes, 'ASSET_BUDGET', 'Local assets exceed the serialized byte budget.');
    resolved.set(id, asset); return asset;
  }
  for (const node of assetNodes) await resolve(node.id);
  return [...resolved.values()];
}

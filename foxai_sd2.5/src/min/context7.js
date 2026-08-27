

import { CONTRACTS, SD25_VERSION } from './contracts.js';

const CONTEXT7_BASE = 'https://context7.com/api/v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时缓存

const cache = new Map();

async function fetchContext7Docs(library = 'seedance-2-5', topic = 'prompt contracts', signal) {
  const cacheKey = `${library}:${topic}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `${CONTEXT7_BASE}/context?library=${encodeURIComponent(library)}&topic=${encodeURIComponent(topic)}&tokens=5000`;
  try {
    const response = await fetch(url, { signal, method: 'GET' });
    if (!response.ok) {
      return { ok: false, error: `Context 7 returned ${response.status}` };
    }
    const data = await response.json();
    cache.set(cacheKey, { ts: Date.now(), data });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function getLatestSpecs({ topic = 'prompt contracts', signal } = {}) {
  const result = await fetchContext7Docs('seedance-2-5', topic, signal);
  if (result.ok) {
    return {
      source: 'context7',
      library: 'seedance-2-5',
      topic,
      content: result.data,
      version: SD25_VERSION,
      fetchedAt: new Date().toISOString(),
    };
  }

  return {
    source: 'embedded',
    library: 'seedance-2-5',
    topic,
    contracts: CONTRACTS,
    version: SD25_VERSION,
    fallbackReason: result.error,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getContractSpec(contractId, { signal } = {}) {

  const latest = await getLatestSpecs({ topic: `${contractId} contract`, signal });
  if (latest.source === 'context7') {
    return {
      source: 'context7',
      contractId,
      content: latest.content,
    };
  }

  const contract = CONTRACTS[contractId];
  if (!contract) {
    return { source: 'embedded', contractId, found: false };
  }
  return {
    source: 'embedded',
    contractId,
    found: true,
    name: contract.name,
    durationRange: contract.durationRange,
    description: contract.description,
    template: contract.template,
    requiredSections: contract.requiredSections,
    placeholder: contract.placeholder,
  };
}

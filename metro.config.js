const { getDefaultConfig } = require('expo/metro-config');
const { FileStore } = require('metro-cache');
const path = require('path');
const os = require('os');
const fs = require('fs');

const config = getDefaultConfig(__dirname);

// Persistenter Transform-/Minify-Cache an einem festen Ort, den scripts/build.js
// NICHT löscht. Hintergrund: build.js führt vor jedem Deployment-Build
// clearMetroCache() aus und löscht dabei `.metro-cache` UND
// `node_modules/.cache/metro` – also genau die Standard-Cache-Orte von Metro/Expo.
// Dadurch war JEDER Deployment-Build kalt: iOS + Android werden gleichzeitig gegen
// EINEN Worker-Pool gebündelt (je hartes 120-s-Limit) und liefen ins Timeout.
// Dieser FileStore liegt unter os.tmpdir() und überlebt clearMetroCache(); ein
// Warmlauf-Schritt im Build-Command (deploy-warmup.mjs) füllt ihn sequen­ziell
// vor, sodass die anschließende parallele Bündelung von build.js Cache-Treffer
// erhält und in Sekunden statt Minuten fertig ist. Lokal/Dev verhält er sich wie
// ein normaler Metro-Cache.
const DEPLOY_CACHE_DIR = path.join(os.tmpdir(), 'metro-deploy-cache');
config.cacheStores = [new FileStore({ root: DEPLOY_CACHE_DIR })];

// maxWorkers an die TATSÄCHLICH zugeteilte CPU-Zahl der laufenden Maschine koppeln.
//
// Hintergrund: scripts/build.js bündelt iOS + Android gleichzeitig gegen EINE
// Metro-Instanz; beide teilen sich diesen Worker-Pool und jedes Bundle hat ein
// hartes 120-s-Download-Limit. Die CPU-gebundene Transform-/Minify-Phase ist genau
// der Schritt, der ins Timeout läuft. Früher war maxWorkers fix auf 2 gepinnt – das
// war korrekt für die alte 2-vCPU-Build-Maschine (cr-2-4), verschenkt aber auf der
// heutigen 8-vCPU-Maschine (cr-8-32) 6 von 8 Kernen, sodass der kalte Build trotz
// Hardware-Upgrade weiter am 2-Minuten-Limit scheiterte.
//
// os.cpus() ist in Containern untreu (meldet oft die Host-Kernzahl statt des
// cgroup-Limits) und wird daher gemieden. Die zuverlässige Quelle ist die echte
// Zuteilung. WICHTIG: cgroup-CFS-Quote (cpu.max) und cpuset können auseinanderlaufen
// – im 2-Kern-Dev-Container meldet cpu.max eine Quote von 8, aber cpuset.effective /
// die Scheduler-Affinität erlauben nur 2 Kerne. Bindend ist das MINIMUM aus beiden,
// sonst würde der Dev-Container oversubscriben (laut Messung langsameres HMR).
function detectAllocatedCpus() {
  const candidates = [];

  // 1. Scheduler-Affinität / cpuset: Kerne, auf denen der Prozess wirklich laufen
  //    darf. os.availableParallelism() (Node 18.14+) respektiert die per cpuset
  //    gesetzte Affinität.
  try {
    if (typeof os.availableParallelism === 'function') {
      const n = os.availableParallelism();
      if (Number.isFinite(n) && n > 0) candidates.push(n);
    }
  } catch (_) {}

  // 2. cgroup v2 CFS-Quote: /sys/fs/cgroup/cpu.max => "<quota> <period>"
  try {
    const raw = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim();
    const [quota, period] = raw.split(/\s+/);
    if (quota !== 'max') {
      const cores = Math.floor(Number(quota) / Number(period));
      if (Number.isFinite(cores) && cores > 0) candidates.push(cores);
    }
  } catch (_) {}

  // 3. cgroup v1 Fallback: cfs_quota_us / cfs_period_us
  try {
    const quota = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8').trim());
    const period = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8').trim());
    if (quota > 0 && period > 0) {
      const cores = Math.floor(quota / period);
      if (Number.isFinite(cores) && cores > 0) candidates.push(cores);
    }
  } catch (_) {}

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

// Untergrenze 2 (Dev-Container), sonst alle Kerne minus 1 für den Hauptthread.
// Build-Maschine 8 -> 7 Worker; 2-Kern-Dev-Container -> 2 (kein Oversubscribe);
// unbekannt -> konservativer Default 2.
const detectedCpus = detectAllocatedCpus();
config.maxWorkers = detectedCpus ? Math.max(2, detectedCpus - 1) : 2;

// react-native-maps zieht Native-only Module ein und kann nicht auf Web gebündelt werden.
// Auf Web auf einen No-op-Stub umleiten, damit der Web-Build (Deployment) durchläuft.
const mapsWebStub = path.resolve(__dirname, 'client/lib/stubs/react-native-maps.web.tsx');
const originalResolveRequest = config.resolver?.resolveRequest;
config.resolver = {
  ...config.resolver,
  resolveRequest: (context, moduleName, platform) => {
    if (platform === 'web' && (moduleName === 'react-native-maps' || moduleName.startsWith('react-native-maps/'))) {
      return { type: 'sourceFile', filePath: mapsWebStub };
    }
    if (originalResolveRequest) {
      return originalResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

config.watcher = {
  ...config.watcher,
  additionalExts: config.watcher?.additionalExts || [],
  watchman: false,
  healthCheck: {
    enabled: false,
  },
};

const originalBlockList = config.resolver?.blockList;
const localRegex = /\.local\/.*/;

if (originalBlockList) {
  if (Array.isArray(originalBlockList)) {
    config.resolver.blockList = [...originalBlockList, localRegex];
  } else {
    config.resolver.blockList = [originalBlockList, localRegex];
  }
} else {
  config.resolver.blockList = localRegex;
}

module.exports = config;

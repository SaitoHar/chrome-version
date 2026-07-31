import versions from '../versions.json';
import GithubReleases from './GithubReleases';
import { getAssetName } from './dirUtils';
import * as Mac from './mac';
import * as Windows from './windows';
import * as Debian from './debian';

const osesToSync = process.env.SYNC_OS_KEYS.split(',').map(x => x.trim());
const minVersion = process.env.SYNC_MIN_VERSION;
const maxReleases = Number(process.env.SYNC_MAX_RELEASES ?? 0);
// an explicit list builds exactly those versions and ignores the min/max bounds
const onlyVersions = (process.env.SYNC_VERSIONS ?? '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

async function syncVersions() {
  const releases = new GithubReleases();
  const versionEntries = Object.entries(versions);
  // newest first, so a timed-out job still produces the versions that matter
  versionEntries.sort((a, b) => compareVersions(b[0], a[0]));

  if (onlyVersions.length) {
    console.log('Building an explicit version list:', onlyVersions.join(', '));
    for (const version of onlyVersions) {
      if (!versions[version]) console.log('WARNING: %s is not in versions.json', version);
    }
  }

  let built = 0;
  for (const [version, urls] of versionEntries) {
    if (onlyVersions.length && !onlyVersions.includes(version)) continue;
    if (!onlyVersions.length && minVersion && compareVersions(version, minVersion) < 0) continue;

    const osesWithUrl = osesToSync.filter(os => urls[os]);
    if (!osesWithUrl.length) continue;

    let release = await releases.get(version);
    const missing = osesWithUrl.filter(
      os => !release?.assets.some(a => a.name === getAssetName(os, version)),
    );
    if (!missing.length) continue;

    if (!onlyVersions.length && maxReleases && built >= maxReleases) {
      console.log('Reached SYNC_MAX_RELEASES=%s, stopping before %s', maxReleases, version);
      break;
    }

    if (!release) {
      console.log('Creating missing Chrome Release for %s', version);
      release = await releases.create(version);
    }

    for (const osToSync of missing) {
      console.log(`Asset needed for Chrome %s on %s`, version, osToSync);

      if (osToSync === 'win32' || osToSync === 'win64') {
        await Windows.process(osToSync, version, releases);
      } else if (osToSync === 'mac' || osToSync === 'mac_arm64') {
        await Mac.process(osToSync, version, releases);
      } else if (osToSync === 'linux') {
        await Debian.process(osToSync, version, releases);
      }
    }
    built += 1;
  }

  process.exit();
}

syncVersions().catch(err => {
  console.log('Exception occurred', err);
  process.exit(1);
});

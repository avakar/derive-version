const core = require('@actions/core');
const child_process = require('child_process');
const fs = require('fs');

function runGit(args) {
  return child_process.execFileSync('git', args, { encoding: 'ascii' }).trim();
}

function readShallow() {
  try {
    const contents = fs.readFileSync('.git/shallow', { encoding: 'ascii' });
    return new Set(contents.trim().split('\n'));
  } catch {
    return new Set();
  }
}

function resolveBlob(commit, path) {
    const [mode, type, oid] = runGit(['ls-tree', commit, path]).split('\t', 1)[0].split(' ');
    if (type != 'blob') {
      return null;
    } else {
      return oid;
    }
}

class Walker {
  constructor(filename, head) {
    this._filename = filename;
    this._blobId = resolveBlob(head, filename);
    this._boundary = new Map();
    this._boundary.set(head, 0);
    this._depth = 0;
    this.updateShallow();
  }

  updateShallow() {
    this._shallow = readShallow();
  }

  _processLine(line) {
    line = line.trim();
    if (line.size == 0) {
      return true;
    }

    let [commit, ...parents] = line.split(' ');

    let depth = this._boundary.get(commit);
    if (depth !== undefined) {
      if (this._shallow.has(commit)) {
        return false;
      }

      this._boundary.delete(commit);

      if (resolveBlob(commit, this._filename) === this._blobId) {
        if (this._depth < depth) {
          this._depth = depth;
        }

        for (const parent of parents) {
          const prevDepth = this._boundary.get(parent);
          if (prevDepth === undefined || prevDepth < depth + 1) {
            this._boundary.set(parent, depth + 1);
          }
        }
      }
    }

    return true;
  }

  walk() {
    const self = this;
    return new Promise((resolve, reject) => {
      const p = child_process.spawn(
        'git',
        ['log', '--topo-order', '--format=format:%H %P', ...self._boundary.keys()],
        { stdio: ['ignore', 'pipe', 'inherit'] }
        );

      function kill() {
        p.stdout.removeAllListeners();
        p.removeAllListeners();
        p.kill();
        p.unref();
      }

      function processLine(line) {
        if (!self._processLine(line)) {
          kill();
          resolve(null);
          return true;
        }

        if (self._boundary.size == 0) {
          kill();
          resolve(self._depth);
          return true;
        }

        return false;
      }

      let linePrefix = '';
      p.stdout.on('data', (data) => {
        try {
          linePrefix += data;
          let pos = linePrefix.indexOf('\n');
          while (pos >= 0) {
            let line = linePrefix.slice(0, pos);
            linePrefix = linePrefix.slice(pos + 1);
            if (processLine(line)) {
              return;
            }
            pos = linePrefix.indexOf('\n');
          }
        } catch (error) {
          kill();
          reject(error);
        }
      });

      p.on('close', (code) => {
        try {
          if (code !== 0) {
            throw new Error('git log failed');
          }

          if (linePrefix.length == 0 || !processLine(linePrefix)) {
            throw new Error('internal algorithm error');
          }
        } catch (error) {
          kill();
          reject(error);
        }
      });
    });
  }
};

async function main() {
  const commit = core.getInput('commit', { required: true });
  const versionFileName = core.getInput('file', { required: true });
  const deepenBy = parseInt(core.getInput('deepen-by', { required: true }));

  const head = runGit(['rev-parse', '--verify', commit]);
  const versionPrefix = runGit(['show', `${head}:${versionFileName}`]);

  const walker = new Walker(versionFileName, head);
  let depth;
  while ((depth = await walker.walk()) === null) {
    core.info(`The repo is too shallow, deepening it by ${deepenBy} commits...`);
    runGit(['fetch', `--deepen=${deepenBy}`]);
    walker.updateShallow();
  }

  core.info(`Version ${versionPrefix}.${depth}`);
  core.setOutput('version', `${versionPrefix}.${depth}`);
  core.setOutput('patch', `${depth}`);
}

main().catch(function(error) {
  core.setFailed(error.message);
});

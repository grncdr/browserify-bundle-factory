var crypto = require('crypto');
var fs     = require('fs');
var path   = require('path');

var browserify             = require('browserify');
var defined                = require('defined');
var createDependencyStream = require('create-dependency-stream');
var mapAsync               = require('map-async');
var once                   = require('once');
var symlinkDependencies    = require('symlink-dependencies');
var through                = require('through');

module.exports = bundleFactory;

function bundleFactory(opts) {
  opts = defined(opts, {});
  var rootBundleDir = defined(opts.bundleDir, __dirname + '/bundles');
  var npmOpts = {
    cache: defined(opts.cache, __dirname + '/cache')
  }

  return getBundle;

  function getBundle(pkgJSON, sources, browserifyOptions) {
    var out = through();

    prepareBundle(pkgJSON, function (err, installDir) {
      if (err) return out.emit('error', err);
      var hash = crypto.createHash('sha1');
      for (var srcPath in sources) {
        hash.update(srcPath);
        hash.update(sources[srcPath].source);
      }
      var bundleDir  = path.join(installDir, hash.digest('hex'));
      var bundlePath = path.join(bundleDir, 'bundle.js');
      fs.exists(bundlePath, function (exists) {
        if (exists) {
          fs.createReadStream(bundlePath).pipe(out);
        } else {
          makeBundle(bundleDir, sources, function (err, b) {
            if (err) return out.emit('error', err);
            out.pipe(fs.createWriteStream(bundlePath));
            b.bundle().pipe(out);
          });
        }
      })
    })

    return out;

    function makeBundle(bundleDir, sources, callback) {
      var b = browserify(browserifyOptions);
      fs.mkdir(bundleDir, function (err) {
        if (err && err.code != 'EEXIST') return callback(err);
        mapAsync(
          sources,
          function (file, dest, next) {
            var destPath = path.join(bundleDir, dest);
            fs.writeFile(destPath, file.source, function (err) {
              if (err) return next(err);
              b.require(destPath, file.options || {})
              next()
            });
          },
          function (err) { callback(err, b) }
        )
      })
    }
  }

  function prepareBundle(pkgJSON, callback) {
    callback = once(callback);
    var rootDep = {
      name:         pkgJSON.name,
      versionRange: pkgJSON.version,
      version:      pkgJSON.version,
      parent:       null,
      'package':    pkgJSON,
      dependencies: {}
    }

    // Get all our deps wired up with symlinks in the cache
    createDependencyStream(pkgJSON, npmOpts)
      .pipe(symlinkDependencies.streamMapper(npmOpts))
      .on('data', function (dep) {
        if (!dep.parent) {
          dep.parent = rootDep;
          rootDep.dependencies[dep.name] = dep;
        }
      })
      .on('error', callback)
      .on('end', prepareBundleDeps.bind(null, rootDep, callback));
  }

  function prepareBundleDeps(rootDep, callback) {
    var deps = rootDep.dependencies;
    var hash = crypto.createHash('sha1');
    hashDeps(deps, hash);
    var installDir = getInstallDir(hash.digest('hex'));
    var moduleDir = path.join(installDir, 'node_modules');
    symlinkDependencies(npmOpts.cache, moduleDir, deps, function (err) {
      callback(err, installDir)
    });
  }

  function getInstallDir(digest) {
    return [rootBundleDir]
      .concat(digest.substring(0, 6).match(/../g))
      .concat([digest.substring(6)])
      .join('/');
  }

  function hashDeps(deps, hash, parent) {
    parent = parent || '';
    Object.keys(deps).sort().forEach(function (name) {
      var path = parent + '!' + name;
      if (deps[name].dependencies) {
        hashDeps(deps[name].dependencies, hash, path);
      }
      hash.update(path)
      hash.update(deps[name].version);
    })
  }
}

if (module === require.main) {
  (function () {
    var bundler = bundleFactory()
    var json = {
      name: 'my-pkg',
      version: '0.0.0',
      dependencies: {
        'tape': 'latest'
      }
    };
    var sources = {
      './index.js': {
        source: 'require("tape")',
        options: {entry: true}
      }
    }
    bundler(json, sources, {})
      .pipe(process.stdout)
  })()
}

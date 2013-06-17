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
    var handleError = out.emit.bind(out, 'error');

    prepareBundle(pkgJSON, function (err, installDir) {
      if (err) return handleError(err);
      var hash = crypto.createHash('md5');
      Object.keys(sources).sort().forEach(function (srcPath) {
        hash.update(srcPath);
        hash.update(sources[srcPath].source);
      })
      hash = hash.digest('base64').slice(0, 22);
      var bundleDir  = path.join(installDir, hash);
      var bundlePath = bundleDir + '.js';
      fs.exists(bundlePath, function (exists) {
        if (exists) {
          var r = fs.createReadStream(bundlePath);
          r.on('error', handleError);
          r.pipe(out);
        } else {
          makeBundle(bundleDir, sources, function (err, b) {
            if (err) return handleError(err);
            out.pipe(fs.createWriteStream(bundlePath));
            b.bundle().on('error', handleError).pipe(out);
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
              var opts = file.options || { expose: destPath };
              opts.basedir = bundleDir;
              b.require(destPath, opts)
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

    var deps = {}

    var pkgSums = {}
    // Get all our deps wired up with symlinks in the cache
    createDependencyStream(pkgJSON, npmOpts)
      .pipe(symlinkDependencies.streamMapper(npmOpts))
      .on('data', function (dep) {
        if (!dep.parent) {
          deps[dep.name] = dep;
        }
        if (dep['package'] && dep['package'].dist) {
          pkgSums[dep['package']._id] = dep['package'].dist.shasum;
        }
      })
      .on('error', callback)
      .on('end', prepareBundleDeps.bind(null, deps, pkgSums, callback));
  }

  function prepareBundleDeps(deps, pkgSums, callback) {
    var hash = crypto.createHash('md5');
    Object.keys(pkgSums).sort().forEach(function (id) {
      hash.update(pkgSums[id])
    })
    var installDir = getInstallDir(hash.digest('base64').substring(0, 22));
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

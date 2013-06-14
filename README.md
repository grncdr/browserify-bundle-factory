# browserify-bundle-factory

So alpha it hurts. Also, this is way too big and I'm going to break it down.

## synopsis

```javascript
var bundleFactory  = require('browserify-bundle-factory');

var getBundle = bundleFactory({
  cache: __dirname + '/package-cache',
  bundleDir: __dirname + '/public/bundles'
});

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

bundler(json, sources, {}).pipe(process.stdout)
```

# License

MIT

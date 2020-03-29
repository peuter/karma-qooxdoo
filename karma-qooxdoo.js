var fs = require("fs");
var path = require('path');

var qooxdooProxies = {};

var createPattern = function(file, included, served, watched) {
  return {
    pattern  : file,
    included : typeof included === "boolean" ? included : true,
    served   : typeof served === "boolean" ? served : true,
    watched  : typeof watched === "boolean" ? watched : false
  }
};

var initQooxdoo = function(logger, config, customFilehandlers) {
  var log = logger.create('framework.qooxdoo');
  var files = config.files;
  var basePath = config.basePath;

  // if the jasmine framework is used, we use the jasmine test runner
  var testRunner = config.frameworks.indexOf("jasmine") > -1 ? "jasmine" : "qooxdoo";

  var includeFiles = false;
  for (var pre in config.preprocessors) {
    config.preprocessors[pre].forEach(function(prePro){
      if (prePro === 'coverage') {
        includeFiles = true;
        return;
      }
    });
    if (includeFiles === true) {
      break;
    }
  }

  var qooxdooCustomFileHandler = function (request, response) {
    var url = request.url;
    var normalizedPath = url.indexOf('?') > -1 ? url.substring(0, url.indexOf('?')) : url;
    for (var proxy in qooxdooProxies) {
      if (normalizedPath.startsWith(proxy)) {
        normalizedPath = path.join(qooxdooProxies[proxy],normalizedPath.substring(proxy.length));
        break;
      }
    }
    var content = fs.readFileSync(normalizedPath);
    response.writeHead(200);
    response.end(content);
  };

  // hard coded proxy as it is always needed
  qooxdooProxies['/script'] = path.join(basePath,'test','script');

  var testsSourceFile = '';
  var errorMessage = '';
  var relPath = ''
  var included = false;

  if (config.qooxdooFramework && config.qooxdooFramework.testSources === true) {
    // testing sources => add source files to the server
    switch (testRunner) {
      case "jasmine":
        if (config.qooxdooFramework.codePath) {
          testsSourceFile = path.resolve(basePath, path.join(config.qooxdooFramework.codePath, config.qooxdooFramework.scriptFile));
        } else {
          testsSourceFile = path.resolve(basePath, path.join('source', 'script', config.qooxdooFramework.scriptFile));
        }
        
        relPath = "source";
        includeFiles = true;
        included = true;
        break;

      default: // qooxdoo testrunner
        testsSourceFile = path.resolve(basePath, path.join('test','script','tests-source.js'));
        relPath = path.join('test','html');
        break;
    }
    if (!fs.existsSync(testsSourceFile)) {
      log.error("Aborted due to missing test sources.\n" + testsSourceFile + "not found\n");
      process.exit();
    }

    var source = fs.readFileSync(testsSourceFile).toString();
    var qx = {
      $$appRoot: path.dirname(testsSourceFile) + path.sep
    };


    // read libinfo
    matches = source.match(/var libinfo = {([^;]+)};\n/ms);
    eval("qx.$$libraries = {" + matches[1] + "};");

    // read loader settings
    matches = source.match(/qx\.\$\$loader = {\n((.|\n)+)(?=^};$\n\n)/m);
    let loaderCode = matches[1].replace("isLoadParallel: !isFirefox && !isIE11 && 'async' in document.createElement('script'),", "isLoadParallel: false,")
    loaderCode = loaderCode.replace("splashscreen: window.QOOXDOO_SPLASH_SCREEN || null,", "splashscreen: null,")
    eval("var loader = qx.$$loader = { " + loaderCode + " };");
    qx.$$loader.addNoCacheParam = false;

    // load project files
    var bootUris = [];
    var partsUris = [];
    var bootPart = loader.parts.boot[0];

    for (var key in loader.packages) {
      if (key == bootPart) {
        bootUris.push.apply(bootUris, loader.decodeUris(loader.packages[key].uris).reverse());
      } else {
        partsUris.push.apply(partsUris, loader.decodeUris(loader.packages[key].uris).reverse());
      }
    }
    var loadUri = function(uri, includedOverride) {

      // uris are relative to the test/html directory
      var absolutePath = path.resolve(basePath, relPath, uri);
      var relativePath = absolutePath.startsWith(basePath) ? absolutePath.replace(basePath, "") : null;

      if (includeFiles) {
        files.unshift(createPattern(absolutePath, includedOverride, true, config.autoWatch));
      }

      if (relativePath) {
        // proxy to base
        var source = relativePath.split(path.sep)[1];
        var target = path.join(basePath,source);
        if (testRunner === "qooxdoo" && !qooxdooProxies["/"+source]) {
          qooxdooProxies["/"+source] = target;
        }
      }
      else {
        var parts = uri.split(path.sep);
        var part = parts.shift();
        while (part === "..") {
          part = parts.shift();
        }
        if (testRunner === "qooxdoo" && !qooxdooProxies["/"+part]) {
          qooxdooProxies["/"+part] = absolutePath.substring(0, absolutePath.indexOf(part) + part.length);
        }
      }
    };
    // do not include the part uris
    partsUris.forEach(function(uri) {
      loadUri(uri, false);
    });
    bootUris.forEach(function(uri) {
      loadUri(uri, included);
    });

    files.unshift(createPattern(testsSourceFile));

    // loads urisBefore
    var urisBefore = loader.decodeUris(loader.urisBefore, "resourceUri");
    urisBefore.reverse();
    urisBefore.forEach(function(uri) {
      // uris are relative to the test/html directory
      var absolutePath = path.resolve(basePath, relPath, uri);
      var relativePath = absolutePath.startsWith(basePath) ? absolutePath.replace(basePath, "") : null;
      if (includeFiles) {
        files.unshift(createPattern(absolutePath, included));
      }
      if (relativePath) {
        var source = uri.split(path.sep)[0];
        if (testRunner === "qooxdoo" && !qooxdooProxies["/"+source]) {
          qooxdooProxies["/"+source] = path.join(basePath,'source',source);
        }
      } else {
        var parts = uri.split(path.sep);
        var part = parts.shift();
        while (part === "..") {
          part = parts.shift();
        }
        if (testRunner === "qooxdoo" && !qooxdooProxies["/"+part]) {
          qooxdooProxies["/"+part] = absolutePath.substring(0, absolutePath.indexOf(part) + part.length);
        }
      }
    });

    if (includeFiles === false) {
      for (var source in qooxdooProxies) {
        customFilehandlers.push({
          urlRegex : new RegExp("^" + source + ".*$"),
          handler  : qooxdooCustomFileHandler
        });
      }
    }
  }
  else {    
    if (config.qooxdooFramework.codePath) {
      testsSourceFile = path.resolve(basePath, config.qooxdooFramework.codePath, config.qooxdooFramework.scriptFile);
    } else {
      testsSourceFile = path.resolve(basePath, path.join('test','script','tests.js'));
    }
    if (!fs.existsSync(testsSourceFile)) {
      log.error("Aborted due to missing tests.\n" + testsSourceFile + " not found\n");
      process.exit();
    }
    files.push(createPattern(testsSourceFile));
  }
  if (testRunner === "qooxdoo") {
    files.push(createPattern(path.resolve(__dirname, "qooxdoo-adapter.js")));
  }
};


initQooxdoo.$inject = ['logger', 'config', 'customFileHandlers'];

module.exports = {
  'framework:qooxdoo' : ['factory', initQooxdoo]
};

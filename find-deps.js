var fs = require('fs');
var dirname = require('path').dirname;
var pathJoin = require('path').join;

var mine = require('./mine.js');
var modules = {};

exports.flush = flush;
function flush() {
  var output = modules;
  modules = {};
  return output;
}

exports.add = add;
function add(path) {
  if (path in modules) return path;
  var base = dirname(path);
  var code = fs.readFileSync(path, "utf8");
  var adjust = 0;
  modules[path] = undefined;
  mine(code).forEach(function (match) {
    var name = match.name;
    var newPath = baseResolve(base, name);
    if (!newPath) {
      console.error("Warning: Can't find " + name + " relative to " + base);
      return;
    }
    newPath = newPath.replace(/\\/g, "\\\\");
    var offset = adjust + match.offset;
    var oldLen = name.length;
    code = code.substr(0, offset) + newPath + code.substr(offset + oldLen);
    adjust += newPath.length - oldLen;
  });
  modules[path] = code;
  return path;
}

function addJson(path) {
  if (path in modules) return path;
  var json = fs.readFileSync(path, "utf8");
  modules[path] = "module.exports = " + json;
  return path;
}

function baseResolve(base, name) {
  if (name[0] === "/") return localResolve(name);
  if (name[0] === ".") return localResolve(pathJoin(base, name));
  var newBase = base;
  while (true) {
    var result = localResolve(pathJoin(newBase, "node_modules", name));
    if (result) return result;
    if (newBase.length === 1) return false;
    newBase = dirname(newBase);
  }
}

function localResolve(path) {
  if (/\.js$/.test(path)) {
    if (fs.existsSync(path)) return add(path);
    return false;
  }
  if (/\.json$/.test(path)) {
    if (fs.existsSync(path)) return addJson(path);
    return false;
  }
  var packagePath = pathJoin(path, "package.json");
  if (fs.existsSync(packagePath)) {
    var json = fs.readFileSync(packagePath);
    var meta = JSON.parse(json);
    if (meta.main) {
      return localResolve(pathJoin(path, meta.main));
    }
  }
  var indexPath = pathJoin(path, "index.js");
  if (fs.existsSync(indexPath)) {
    return add(indexPath);
  }
  if (fs.existsSync(path + ".js")) {
    return add(path + ".js");
  }
  if (fs.existsSync(path + ".json")) {
    return addJson(path + ".json");
  }
  return false;
}

exports.build = function (source, callback) {
  // TODO: make this not using blocking I/O?
  var codes;
  try {
    add(source);
    var modules = flush();
    codes = Object.keys(modules).map(function (name) {
      return wrap(name, modules[name]);
    });
    codes.unshift("var modules = {};\nvar definitions = {};");
    codes.push($require.toString().replace('$require', 'require'));
    codes.push("require(" + JSON.stringify(source) + ");");
  }
  catch (err) {
    return callback(err);
  }
  var code = "(function (realRequire) {" + indent(codes.join("\n\n")) + "}(typeof require === 'function' ? require : console.error.bind(console, 'Missing Module')));";
  callback(null, code);
};

// Launched as CLI tool.
if (process.argv[1] === __filename) {
  for (var i = 2; i < process.argv.length; i++) {
    add(process.argv[i]);
  }
  var modules = flush();
  var codes = Object.keys(modules).map(function (name) {
    return wrap(name, modules[name]);
  });
  codes.unshift("var modules = {};\nvar definitions = {};");
  codes.push($require.toString().replace('$require', 'require'));
  for (var i = 2; i < process.argv.length; i++) {
    codes.push("require(" + JSON.stringify(process.argv[i]) + ");");
  }
  var code = "(function (realRequire) {" + indent(codes.join("\n\n")) + "}(typeof require === 'function' ? require : undefined));";
  console.log(code);
}

function wrap(path, code) {
  return "definitions[" + JSON.stringify(path) + "] = function (module, exports) {" + indent(code) + "};";
}

function indent(code) {
  if (!code) return "";
  return "\n  " + code.split("\n").join("\n  ").trim() + "\n";
}

function $require(name) {
  if (name in modules) return modules[name];
  if (!(name in definitions)) return realRequire(name);
  var exports = {};
  var module = {exports:exports};
  modules[name] = module.exports;
  definitions[name](module, exports);
  return modules[name] = module.exports;
}

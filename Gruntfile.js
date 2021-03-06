'use strict';

module.exports = function(grunt) {
  require('time-grunt')(grunt);

  var distDir = './dist';
  var outputDir = './output';
  var pkgjs = require('./package.json');
  var pkgName = pkgjs.name;
  var buildNumber = (process.env['BUILD_NUMBER'] || 'BUILD-NUMBER');
  var packageVersion = pkgjs.version.replace('BUILD-NUMBER', buildNumber);
  var releaseDir = pkgName + '-' + packageVersion;
  var releaseFile = pkgName + '-' + packageVersion + '.tar.gz';
  var path = require('path');
  var fs = require('fs-extra');
  var async = require('async');
  var _ = require('underscore');
  var underscoreDeepExtend = require('underscore-deep-extend');
  _.mixin({deepExtend: underscoreDeepExtend(_)});



  // Project Configuration
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    jshint: {
      all: ['lib/*.js', 'lib/cmd/fh3/**/*.js'],
      options: {
        jshintrc: true
      }
    },
    shell: {
      unit: {
        options: {
          stdout: true,
          stderr: true,
          failOnError: true
        },
        command: 'env NODE_PATH=.:./lib ./node_modules/.bin/turbo --setUp ./test/setupTeardown.js --tearDown ./test/setupTeardown.js test/unit/**/**/**/*'
      },
      accept: {
        options: {
          stdout: true,
          stderr: true,
          failOnError: true
        },
        // some database trouncing going on here at the moment, tests need to run in a particular order, these all need a refactor
        command:
          'env NODE_PATH=.:./lib ./node_modules/.bin/turbo test/accept/*'
      },
      coverage_unit: {
        options: {
          stdout: true,
          stderr: true,
          failOnError: true
        },
        command: [
          'rm -rf coverage cov-unit',
          'env NODE_PATH=.:./lib ./node_modules/.bin/istanbul cover --dir cov-unit ./node_modules/.bin/turbo --setUp ./test/setupTeardown.js --tearDown ./test/setupTeardown.js test/unit/*/*',
          './node_modules/.bin/istanbul report',
          'echo "See html coverage at: `pwd`/coverage/lcov-report/index.html"'
        ].join('&&')
      },
      coverage_accept: {
        options: {
          stdout: true,
          stderr: true,
          failOnError: true
        },
        command: [
          'rm -rf coverage cov-accept',
          'env NODE_PATH=.:./lib ./node_modules/.bin/istanbul cover --dir cov-accept ./node_modules/.bin/turbo test/accept/*',
          './node_modules/.bin/istanbul report',
          './node_modules/.bin/istanbul report --report cobertura',
          'echo "See html coverage at: `pwd`/coverage/lcov-report/index.html"'
        ].join('&&')
      },
      clean : {
        options: {
          stdout: true,
          stderr: true,
          failOnError: true
        },
        command: 'rm -rf ' + distDir + ' ' + outputDir + ' ' + releaseDir
      },
      dist : {
        options: {
          stdout: true,
          stderr: true,
          failOnError: true
        },
        command: [
          'mkdir -p ' + distDir + ' ' + outputDir + '/' + releaseDir,
          'cp -r ./lib ' + outputDir + '/' + releaseDir,
          'cp -r ./doc ' + outputDir + '/' + releaseDir,
          'cp -r ./bin ' + outputDir + '/' + releaseDir,
          'cp ./package.json ' +  outputDir + '/' + releaseDir,
          'cp ./README.md ' +  outputDir + '/' + releaseDir,
          'cp ./npm-shrinkwrap.json ' + outputDir + '/' + releaseDir,
          'echo ' +  packageVersion + ' > ' + outputDir + '/' + releaseDir + '/VERSION.txt',
          'sed -i -e s/BUILD-NUMBER/' + buildNumber + '/ ' + outputDir + '/' + releaseDir + '/package.json',
          'tar -czf ' + distDir + '/' + releaseFile + ' -C ' + outputDir + ' ' + releaseDir
        ].join('&&')
      },
      docsToDoxy : {
        options : {
          stdout: true,
          stderr: true,
          failOnError: false
        },
        command : [
          'cp -rf doc/fh3/ ../fh-doxy/public/dev_tools/fhc/',
          'cp -rf doc/common/ ../fh-doxy/public/dev_tools/fhc/',
          'cp -rf doc/fhc/ ../fh-doxy/public/dev_tools/fhc/',
          'cp doc/index.md ../fh-doxy/public/dev_tools/fhc.md',
        ].join('&&')
      }
    },
    plato: {
      src: {
        options : {
          jshint : grunt.file.readJSON('.jshintrc')
        },
        files: {
          'plato': ['lib/**/*.js']
        }
      }
    }
  });

  // Load NPM tasks
  require('load-grunt-tasks')(grunt, {scope: 'devDependencies'});

  // Testing tasks
  grunt.registerTask('test', ['jshint', 'shell:unit', 'shell:accept']);
  grunt.registerTask('unit', ['jshint', 'shell:unit']);
  grunt.registerTask('accept', ['shell:accept']);

  // Coverage tasks
  grunt.registerTask('coverage', ['jshint', 'shell:coverage_unit', 'shell:coverage_accept']);
  grunt.registerTask('coverage-unit', ['shell:coverage_unit']);
  grunt.registerTask('coverage-accept', ['shell:coverage_accept']);

  // Making grunt default to force in order not to break the project.
  grunt.option('force', true);

  grunt.registerTask('analysis', ['plato:src', 'open:platoReport']);

  grunt.registerTask('default', ['test']);

  // dist commands
  grunt.registerTask('dist', ['shell:clean', 'shell:dist']);
  grunt.registerTask('clean', ['shell:clean']);

  grunt.registerTask('docs', ['docs-generate', 'docs-index', 'shell:docsToDoxy']);
  grunt.registerTask('docs-index', function(){
    var fhc = require('./lib/fhc.js');

    /*
      Generates the contents of an index.html file for the tree of (fh3) commands, nicely formatted
     */
    function _genIndex(tree, level, parent){
      var output = [],
      recursors = [], // keep these until last in any list so the .cols look nice
      keys = Object.keys(tree),
      indent = Array(level).join('\t'),
      colSpan = (level <= 2) ? 12 : (12/level),
      innerColSpan = 12/colSpan+2;

      if (level > 1) {
        output.push(indent + '<div class="col-md-' + colSpan + '">');
      }
      output.push(indent + '\t<h3>' + tree._groupName + '</h3>');

      for (var i=0; i<keys.length; i++){
        var key = keys[i],
        cmd = tree[key],
        cmdPath = cmd._path,
        name = cmd._cmdName;

        if (key[0] === '_'){
          continue;
        }

        // Add an entry to our index.md file
        if (typeof cmd === 'object'){
          // recurse
          var recurseRes = _genIndex(cmd, level+1);
          // For 1st-level commands, we want to make sure the sub-commands appear last in the list
          if (level === 1){
            recursors = recursors.concat(recurseRes);
          }else{
            output = output.concat(recurseRes);
          }
        }else{
          // First check if a docs article exists for this command - if not, let's not write it to this index..
          var docMdPath = path.join('doc', cmdPath.replace(/\.js$/, '.md'));
          if (!fs.existsSync(docMdPath)){
            console.log('Warning: No docs file found for ' + docMdPath);
            continue;
          }
          cmdPath = cmd._path.replace(/\.js$/, '.html');
          cmdPath = cmdPath.split('/');
          cmdPath.shift(1);
          cmdPath = cmdPath.join('/');
          // pop off the 'common', 'fh2', 'fh3' parts..

          output.push(indent + '\t<a class="col-md-' + innerColSpan + '" href="fhc/' + cmdPath + '">' + name + '</a>');
        }
      }
      output = output.concat(recursors);
      if (level > 1) {
        output.push(indent + '</div>');
      }
      return output;
    }
    var treeForDoxy = _.deepExtend({}, fhc._tree.fh3, fhc._tree.common, fhc._tree.fhc),
    indexOutput = _genIndex(treeForDoxy, 1),
    docsDir = path.join(__dirname, 'doc'),
    indexFile = path.join(docsDir, 'index.md');
    indexOutput = [
    '<h1>FHC - FeedHenry Command Line Interface API</h1>',
    '<div class="alert alert-info"><strong>Note: </strong> This API Reference is for version ' + fhc._version.replace('+BUILD-NUMBER', ''),
    'of FHC. To ensure you get the most relevant help for the version of FHC you have installed, the <code>fhc help</code> command can be used.',
    'See <a href="https://github.com/feedhenry/fh-fhc#usage">https://github.com/feedhenry/fh-fhc#usage</a> for usage.',
    'To find the version of fhc you have installed, use the <code>fhc version</code> command</div>'
    ].concat(indexOutput);
    // for docs, we're only interested in FH3 commands & don't want to talk about fh2 or internal ones

    fs.writeFileSync(indexFile, indexOutput.join('\n'));

  });

  grunt.registerTask('docs-generate', function(){
    var fhc = require('./lib/fhc.js'),
    help = require('./lib/cmd/fhc/help.js'),
    docsDir = path.join(__dirname, 'doc');

    function writeDocFile(usage, cmd, cb){
      var cmdPath = cmd._path,
      writeTo;
      cmdPath = cmdPath.replace(/\.js$/, '.md'); // Replace the JS extension with that of a markdown file
      writeTo = path.join(docsDir, cmdPath),
      // now write the file
      fs.outputFile(writeTo, usage, cb);
    }

    function genDocs(tree){
      var writerFns = [];
      var keys = Object.keys(tree);
      for (var i=0; i<keys.length; i++){
        var key = keys[i],
        cmd = tree[key];

        // If it's a new-style command, push the getter onto the stack-o-getters..
        if (cmd.demand){
          (function(safeClosureCmd){
            writerFns.push(function(cb){
              help.singleCommandUsageToMd(safeClosureCmd, function(err, usage){
                if (err){
                  return cb(err);
                }
                return writeDocFile(usage, safeClosureCmd, cb);
              });
            });
          })(cmd);

        }else if (typeof cmd === 'object'){
          // recurse
          writerFns = writerFns.concat(genDocs(cmd));
        }
      }
      return writerFns;
    };

    var done = this.async();

    fhc.load(function(conf){
      var tree = fhc._tree,
      writers = genDocs(tree, done);
      async.parallel(writers, done);
    });
  });
};

const fs = require('fs');
const { parse } = require('@babel/parser')
const { transformFromAst, transformSync } = require('@babel/core');
const path = require('path')
const traverse = require('@babel/traverse').default
const { minify } = require('terser')

let ID = 0

async function readModule(absolutePath) {
    const rawCode = fs.readFileSync(absolutePath, 'utf8');

    const ast = parse(rawCode, {
        sourceType: 'module'
    })
    // console.log(ast)

    const depends_on = new Set()
    const dirname = path.dirname(absolutePath)

    traverse(ast, {
        // Targeting a node type : https://babeljs.io/docs/en/babel-traverse#docsNav
        ImportDeclaration: (path) => {
            let relativePath = path.node.source.value
            if (!(depends_on.has(relativePath))) {
                depends_on.add(relativePath)
            }
        }
    })

    const code = transformSync(rawCode, {
        // transpile it to CommonJS to allow for require() functions to be used instead of import statements
        // this is to inject my own local require() function which can be called recursively to traverse the graph and resolve dependencies
        // and also adds declaration for module.exports statement (to export to the my local module variable) later
        plugins: ["@babel/plugin-transform-modules-commonjs"]
    })



    return {
        id: ID++,
        dirname,
        depends_on,
        source: await minify(code.code),
        moduleMap: {}
    }
}

function checkResolvedPath(p1, p1Origin, p2, p2Origin) {
    const resolvedP1 = path.join(p1, p1Origin)
    const resolvedP2 = path.join(p2, p2Origin)
    return resolvedP1 === resolvedP2
}

function checkCyclicDependency(graph) {
    // use depth-first search and traverse through the graph
    return
}

// function checkResolvePath(firstPath, firstDirname, secondPath, seconDirname) {
//     const resolvedFirstPath = path.resolve, 
// }


async function buildDependencyGraph(entry) {
    const entryModule = await readModule(entry)
    let modules = []

    // use breath-first search to traverse all modules
    let queue = [entryModule]
    while (queue.length > 0) {
        let module = queue.pop()
        for (let relativePath of module.depends_on) {
            let child = await readModule(path.join(module.dirname, relativePath))
            // moduleMap's keys needs to be a relative path, since our require() function will take in a relative path
            module.moduleMap[relativePath] = child.id
            queue.push(child)
        }
        // if (!(modules.in)) modules.set(module.id, module)
        modules.push(module)
    }

    return modules
}

function bundle(graph) {
    let modules = {}

    graph.forEach(mod => {
        modules[mod.id] = {
            // use dependency injection to pass the require() method to the CommonJS code!
            // also wrap the module source code in a function to encapsulate it into its own local scope
            fn: () => {
                return new Function('require', 'module', 'exports', mod.source.code)
            },
            moduleMap: mod.moduleMap
        }
    })

    return ((modules) => {

        const require = (id) => {
            const { fn, moduleMap } = modules[id]

            const localRequire = (relativePath) => {
                return require(moduleMap[relativePath])
            }

            // Every file is a module, and the module variable is provided to every file in NodeJS
            // Inject the local created module variable with exports property to the source code
            // Ref: https://nodejs.org/api/modules.html#modules-commonjs-modules
            let localModule = {
                exports: {}
            }

            fn()(localRequire, localModule, localModule.exports)
            // provide the exported values to the parent code, which is stored in the localModule.exports property
            // that is set by CommonJS's module.exports statement in the transpiled CommonJS code
            return localModule.exports
        }

        require(0)
    })(modules)
}

(async () => {
    try {
        let graph = await buildDependencyGraph('./example/functions/entry.js')
        bundle(graph)
    } catch (err) {
        console.log(err)
    }
})()


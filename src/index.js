// Parser
const {parse} = require( 'babylon' );
const extend  = require( 'extend' );
/*

 TEMPLATES to be used

 */
const TEMPLATES = {
	// If element
	'rx-if': {
		priority:  1000,
		fn: function({path, value, opts, t}) {
			const expr = t.conditionalExpression( value, path.node, t.nullLiteral() );
			path.replaceWith( expr );
		}
	},
	// rx-repeat statement
	'rx-repeat': {
		fn: function({path, value, opts, utils, t}) {
			let valueArg = null, keyArg = null, objArg = null;
			if ( t.isBinaryExpression( value, { operator: 'in' } ) ) {
				if ( t.isSequenceExpression( value.left ) ) {
					t.assertIdentifier( value.left.expressions[0] );
					t.assertIdentifier( value.left.expressions[1] );
					valueArg = value.left.expressions[0];
					keyArg = value.left.expressions[1];
				} else {
					t.assertIdentifier( value.left );
					valueArg = value.left;
				}
				objArg = value.right;
			} else {
				objArg = value;
			}


			const block = [];
			if ( valueArg ) {
				block.push( t.variableDeclaration(
					"const",
					[t.variableDeclarator( valueArg, t.identifier( "$value" ) )]
				) );
			}
			if ( keyArg ) {
				block.push( t.variableDeclaration(
					"const",
					[t.variableDeclarator( keyArg, t.identifier( "$key" ) )]
				) );
			}
			block.push( path.node );


			let bodyStatement = null;
			if ( block.length > 1 ) {
				block[block.length-1] = t.returnStatement(block[block.length-1]);
				bodyStatement = t.blockStatement( block );
			} else {
				bodyStatement = block[0];
			}
			
			let mapArgs = [
				objArg,
				t.arrowFunctionExpression( [t.identifier("$value"), t.identifier("$key")], bodyStatement )
			];
			path.replaceWith( t.callExpression( utils.map, mapArgs ) );
		}
	}
};

// Utility
const UTILS = {
	map: '$.map'
};

/*
 Export babel plugin to transform react extended
 */
module.exports = function( babel ) {
	const t = babel.types;

	// Get old visitor
	const babelPlugin = require( "babel-plugin-transform-react-jsx" )( babel );
	const visitor     = babelPlugin.visitor;

	// JSX
	const oldJSXElement = visitor.JSXElement;
	visitor.JSXElement = {
		exit: function( path, state ) {
			oldJSXElement.exit( path, state );

			if ( t.isCallExpression(path.node) ) {
				const attrs = path.node.arguments[1];
				reactExtend( path, attrs, state.opts );
			}
		}
	};
	
	// Parse expression
	function parseExpression( str ) {
		let expr = parse(`(${str})`);
		expr = expr.program.body[0].expression;
		babel.traverse.removeProperties(expr);
		return expr;
	}


	/*
	 Extend the react
	 */
	function reactExtend( path, attrs, opts ) {
		// Attrs
		if ( !t.isObjectExpression( attrs ) )
			return;

		//
		const utils = extend({}, UTILS, (opts && opts.utils) );
		for ( let key in utils )
			utils[key] = parseExpression( utils[key] );
		
		const templates = [];
		attrs.properties = attrs.properties.map(function( item ) {
			if ( !t.isStringLiteral( item.key ) )
				return item;
			const key = item.key.value;
			
			let template = TEMPLATES[key] || (opts && opts.templates && opts.templates[key]);
			if ( !template )
				return item;

			if ( typeof(template) === 'function' )
				template = { fn: template, priority: 0 };
			
			templates.push({
				key:      key,
				value:    item.value,
				priority: template.priority|0,
				fn:       template.fn
			});
			return null;
		}).filter( Boolean );

		// Every template
		templates.sort( (a, b) => b.priority - a.priority );
		templates.forEach(function( template ) {
			template.fn({
				path:  path,
				node:  path.node,
				value: template.value,
				opts:  opts,
				babel: babel,
				utils: utils,
				t:     t
			});
		});
	}
	
	return babelPlugin;
}

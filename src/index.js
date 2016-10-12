// Parser
const {parse} = require( 'babylon' );
const extend  = require( 'extend' );
/*

 TEMPLATES to be used

 */
const TEMPLATES = {
	// If element
	'rx-if': {
		priority:  0,
		fn: function({path, value, opts, t}) {
			const expr = t.conditionalExpression( value, path.node, t.nullLiteral() );
			path.replaceWith( expr );
		}
	},
	// outer-if element
	'rx-outer-if': {
		priority: 2000,
		fn: function({path, value, opts, t}) {
			const elseExpr = path.node._reactExtendedArray ? t.arrayExpression([]) : t.nullLiteral();
			const expr = t.conditionalExpression( value, path.node, elseExpr );
			expr._reactExtendedArray  = path.node._reactExtendedArray;
			path.replaceWith( expr );
		}
	},
	// rx-repeat statement
	'rx-repeat': {
		priority: 1000,
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


			let expr = t.callExpression( utils.map(), mapArgs );
			expr._reactExtendedArray = true;
			path.replaceWith( expr );
		}
	}
};

// Utility
const UTILS = {
	map: ''+function( obj, cb ) {
		const isArray =  Array.isArray ? Array.isArray( obj ) :
			Object.prototype.toString.call( obj ) === '[object Array]'
		;
		let ret = [];
		if ( isArray ) {
			for ( let i = 0; i < obj.length; ++i ) {
				let v = cb( obj[i], i );
				if ( v != null )
					ret.push( v );
			}
		} else {
			for ( let key in obj ) {
				let v = cb( obj[key], key );
				if ( v != null )
					ret.push( v );
			}
		}
		return Array.prototype.concat.apply([], ret);
	}
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
			let virtualContent = null;

			/**
			 Check for rx-virtual node

			 A virtual node does not exist, and is replace by an array of the internal contents
			 Care must be taken so the array will be flattened.
			 */
			if ( path.node.openingElement.name.name === 'rx-virtual' ) {
				let lastVirtual = t.arrayExpression([]);
				
				virtualContent = lastVirtual;
				function virtualConcatElement( element, isArray ) {
					if ( isArray ) {
						if ( t.isArrayExpression( virtualContent ) && virtualContent.elements.length <= 0 ) {

							virtualContent = element;
							lastVirtual    = null;
							return;
						}
						let concat = t.memberExpression( virtualContent,
														 t.identifier( 'concat' ) );
						virtualContent = t.callExpression( concat, [element] );
						lastVirtual = null;
						return;
					}

					if ( !lastVirtual ) {
						lastVirtual = t.arrayExpression([]);
						let concat = t.memberExpression( virtualContent,
														 t.identifier( 'concat' ) );
						virtualContent = t.callExpression( concat, [lastVirtual] );
					}		
					lastVirtual.elements.push( element );	
				}

				
				path.node.children.forEach( (item) => {
					if ( t.isJSXText( item ) ) {
						const newValue = item.value.replace(/\n\s+/g, " ").trim();
						if ( !newValue )
							return;
						virtualConcatElement( t.stringLiteral( newValue ) );
					} else if ( t.isJSXExpressionContainer( item ) ) {
						virtualConcatElement( item.expression );
					} else if ( item._reactExtendedArray ) {
						virtualConcatElement( item, true );
					} else {
						virtualConcatElement( item );
					}
				});
			}


			// Original replace the node
			oldJSXElement.exit( path, state );

			// Check for attributes
			if ( t.isCallExpression(path.node) ) {
				const attrs = path.node.arguments[1];
				if ( virtualContent )
					path.replaceWith( virtualContent );
				reactExtend( path, state, attrs, state.opts );
			}
		}
	};
	
	// Parse expression
	function tryParse( str, options ) {
		try {
			return parse( str, options );
		} catch( err ) {
			return null;
		}
	}
	function parseExpression( str, state, key ) {
		let UID = null;
		return function() {
			if ( UID )
				return UID;
			
			let expr = tryParse( `(${str})`, { sourceType: 'module' } ) || tryParse( str, { sourceType: 'module' } );
			if ( expr == null )
				throw new Error( "Invalid expression for react-extended utils" );

			expr = expr.program.body[0];
			if ( expr.type === "ImportDeclaration" ) {
				let imported = null;
				if ( expr.specifiers ) {
					if ( expr.specifiers.length === 0 ) {
						imported = 'default';
					} else if ( expr.specifiers.length === 1 ) {
						if ( expr.specifiers[0].type === 'ImportNamespaceSpecifier' ) {
							imported = '*';
						} else if ( expr.specifiers[0].type === 'ImportDefaultSpecifier' ) {
							imported = 'default';
						} else if ( expr.specifiers[0].type === 'ImportSpecifier' ) {
							imported = expr.specifiers[0].imported.name;
						}
					}
				}
				if ( !imported ) {
					throw new Error(
						`Invalid specifier declaration for react-extended utils.` +
							`Used '${str}'.`
					);
				}	
				UID = state.addImport( expr.source.value, imported, 'map' );
				return UID;
			} else if ( expr.type === 'ExpressionStatement' ) {
				expr = expr.expression;
				if ( ( expr.type === 'FunctionExpression' ) || ( expr.type === 'FunctionDeclaration' ) ) {
					let name   = 'react-extended-util-'+key;

					let file = state.file || state;
					let declar = file.declarations[name];
					if ( declar )
						return declar;
					UID = file.declarations[name] = file.scope.generateUidIdentifier( 'map' );
					expr.type = "FunctionDeclaration";
					expr.id   = UID;
					expr._generated    = true;
					expr.body._compact = true;
					file.path.unshiftContainer( "body", expr );
					return UID;
				} 
				babel.traverse.removeProperties(expr);
				UID = expr;
				return UID;
			}
			throw new Error( "Invalid expression for react-extended utils" );
		};
	}


	/*
	 Extend the react
	 */
	function reactExtend( path, state, attrs, opts ) {
		// Attrs
		if ( !t.isObjectExpression( attrs ) )
			return;

		//
		const utils = extend({}, UTILS, (opts && opts.utils) );
		for ( let key in utils ) {
			utils[key] = parseExpression( utils[key], state, key );
		}
		
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
		templates.sort( (a, b) => a.priority - b.priority );
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

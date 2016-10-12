'use strict';

// Parser
var _require = require('babylon');

var parse = _require.parse;

var extend = require('extend');
/*

 TEMPLATES to be used

 */
var TEMPLATES = {
	// If element
	'rx-if': {
		priority: 0,
		fn: function fn(_ref) {
			var path = _ref.path;
			var value = _ref.value;
			var opts = _ref.opts;
			var t = _ref.t;

			var expr = t.conditionalExpression(value, path.node, t.nullLiteral());
			path.replaceWith(expr);
		}
	},
	// outer-if element
	'rx-outer-if': {
		priority: 2000,
		fn: function fn(_ref2) {
			var path = _ref2.path;
			var value = _ref2.value;
			var opts = _ref2.opts;
			var t = _ref2.t;

			var elseExpr = path.node._reactExtendedArray ? t.arrayExpression([]) : t.nullLiteral();
			var expr = t.conditionalExpression(value, path.node, elseExpr);
			expr._reactExtendedArray = path.node._reactExtendedArray;
			path.replaceWith(expr);
		}
	},
	// rx-repeat statement
	'rx-repeat': {
		priority: 1000,
		fn: function fn(_ref3) {
			var path = _ref3.path;
			var value = _ref3.value;
			var opts = _ref3.opts;
			var utils = _ref3.utils;
			var t = _ref3.t;

			var valueArg = null,
			    keyArg = null,
			    objArg = null;
			if (t.isBinaryExpression(value, { operator: 'in' })) {
				if (t.isSequenceExpression(value.left)) {
					t.assertIdentifier(value.left.expressions[0]);
					t.assertIdentifier(value.left.expressions[1]);
					valueArg = value.left.expressions[0];
					keyArg = value.left.expressions[1];
				} else {
					t.assertIdentifier(value.left);
					valueArg = value.left;
				}
				objArg = value.right;
			} else {
				objArg = value;
			}

			var block = [];
			if (valueArg) {
				block.push(t.variableDeclaration("const", [t.variableDeclarator(valueArg, t.identifier("$value"))]));
			}
			if (keyArg) {
				block.push(t.variableDeclaration("const", [t.variableDeclarator(keyArg, t.identifier("$key"))]));
			}
			block.push(path.node);

			var bodyStatement = null;
			if (block.length > 1) {
				block[block.length - 1] = t.returnStatement(block[block.length - 1]);
				bodyStatement = t.blockStatement(block);
			} else {
				bodyStatement = block[0];
			}

			var mapArgs = [objArg, t.arrowFunctionExpression([t.identifier("$value"), t.identifier("$key")], bodyStatement)];

			var expr = t.callExpression(utils.map(), mapArgs);
			expr._reactExtendedArray = true;
			path.replaceWith(expr);
		}
	}
};

// Utility
var UTILS = {
	map: '' + function (obj, cb) {
		var isArray = Array.isArray ? Array.isArray(obj) : Object.prototype.toString.call(obj) === '[object Array]';
		var ret = [];
		if (isArray) {
			for (var i = 0; i < obj.length; ++i) {
				var v = cb(obj[i], i);
				if (v != null) ret.push(v);
			}
		} else {
			for (var key in obj) {
				var _v = cb(obj[key], key);
				if (_v != null) ret.push(_v);
			}
		}
		return Array.prototype.concat.apply([], ret);
	}
};

/*
 Export babel plugin to transform react extended
 */
module.exports = function (babel) {
	var t = babel.types;

	// Get old visitor
	var babelPlugin = require("babel-plugin-transform-react-jsx")(babel);
	var visitor = babelPlugin.visitor;

	// JSX
	var oldJSXElement = visitor.JSXElement;
	visitor.JSXElement = {
		exit: function exit(path, state) {
			var virtualContent = null;

			/**
    Check for rx-virtual node
   	 A virtual node does not exist, and is replace by an array of the internal contents
    Care must be taken so the array will be flattened.
    */
			if (path.node.openingElement.name.name === 'rx-virtual') {
				(function () {
					var virtualConcatElement = function virtualConcatElement(element, isArray) {
						if (isArray) {
							if (t.isArrayExpression(virtualContent) && virtualContent.elements.length <= 0) {

								virtualContent = element;
								lastVirtual = null;
								return;
							}
							var concat = t.memberExpression(virtualContent, t.identifier('concat'));
							virtualContent = t.callExpression(concat, [element]);
							lastVirtual = null;
							return;
						}

						if (!lastVirtual) {
							lastVirtual = t.arrayExpression([]);
							var _concat = t.memberExpression(virtualContent, t.identifier('concat'));
							virtualContent = t.callExpression(_concat, [lastVirtual]);
						}
						lastVirtual.elements.push(element);
					};

					var lastVirtual = t.arrayExpression([]);

					virtualContent = lastVirtual;


					path.node.children.forEach(function (item) {
						if (t.isJSXText(item)) {
							var newValue = item.value.replace(/\n\s+/g, " ").trim();
							if (!newValue) return;
							virtualConcatElement(t.stringLiteral(newValue));
						} else if (t.isJSXExpressionContainer(item)) {
							virtualConcatElement(item.expression);
						} else if (item._reactExtendedArray) {
							virtualConcatElement(item, true);
						} else {
							virtualConcatElement(item);
						}
					});
				})();
			}

			// Original replace the node
			oldJSXElement.exit(path, state);

			// Check for attributes
			if (t.isCallExpression(path.node)) {
				var attrs = path.node.arguments[1];
				if (virtualContent) path.replaceWith(virtualContent);
				reactExtend(path, state, attrs, state.opts);
			}
		}
	};

	// Parse expression
	function tryParse(str, options) {
		try {
			return parse(str, options);
		} catch (err) {
			return null;
		}
	}
	function parseExpression(str, state, key) {
		var UID = null;
		return function () {
			if (UID) return UID;

			var expr = tryParse('(' + str + ')', { sourceType: 'module' }) || tryParse(str, { sourceType: 'module' });
			if (expr == null) throw new Error("Invalid expression for react-extended utils");

			expr = expr.program.body[0];
			if (expr.type === "ImportDeclaration") {
				var imported = null;
				if (expr.specifiers) {
					if (expr.specifiers.length === 0) {
						imported = 'default';
					} else if (expr.specifiers.length === 1) {
						if (expr.specifiers[0].type === 'ImportNamespaceSpecifier') {
							imported = '*';
						} else if (expr.specifiers[0].type === 'ImportDefaultSpecifier') {
							imported = 'default';
						} else if (expr.specifiers[0].type === 'ImportSpecifier') {
							imported = expr.specifiers[0].imported.name;
						}
					}
				}
				if (!imported) {
					throw new Error('Invalid specifier declaration for react-extended utils.' + ('Used \'' + str + '\'.'));
				}
				UID = state.addImport(expr.source.value, imported, 'map');
				return UID;
			} else if (expr.type === 'ExpressionStatement') {
				expr = expr.expression;
				if (expr.type === 'FunctionExpression' || expr.type === 'FunctionDeclaration') {
					var name = 'react-extended-util-' + key;

					var file = state.file || state;
					var declar = file.declarations[name];
					if (declar) return declar;
					UID = file.declarations[name] = file.scope.generateUidIdentifier('map');
					expr.type = "FunctionDeclaration";
					expr.id = UID;
					expr._generated = true;
					expr.body._compact = true;
					file.path.unshiftContainer("body", expr);
					return UID;
				}
				babel.traverse.removeProperties(expr);
				UID = expr;
				return UID;
			}
			throw new Error("Invalid expression for react-extended utils");
		};
	}

	/*
  Extend the react
  */
	function reactExtend(path, state, attrs, opts) {
		// Attrs
		if (!t.isObjectExpression(attrs)) return;

		//
		var utils = extend({}, UTILS, opts && opts.utils);
		for (var key in utils) {
			utils[key] = parseExpression(utils[key], state, key);
		}

		var templates = [];
		attrs.properties = attrs.properties.map(function (item) {
			if (!t.isStringLiteral(item.key)) return item;
			var key = item.key.value;

			var template = TEMPLATES[key] || opts && opts.templates && opts.templates[key];
			if (!template) return item;

			if (typeof template === 'function') template = { fn: template, priority: 0 };

			templates.push({
				key: key,
				value: item.value,
				priority: template.priority | 0,
				fn: template.fn
			});
			return null;
		}).filter(Boolean);

		// Every template
		templates.sort(function (a, b) {
			return a.priority - b.priority;
		});
		templates.forEach(function (template) {
			template.fn({
				path: path,
				node: path.node,
				value: template.value,
				opts: opts,
				babel: babel,
				utils: utils,
				t: t
			});
		});
	}

	return babelPlugin;
};

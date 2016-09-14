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

			var expr = t.conditionalExpression(value, path.node, t.nullLiteral());
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
			path.replaceWith(t.callExpression(utils.map, mapArgs));
		}
	}
};

// Utility
var UTILS = {
	map: '$.map'
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
			oldJSXElement.exit(path, state);
			if (t.isCallExpression(path.node)) {
				var attrs = path.node.arguments[1];
				reactExtend(path, attrs, state.opts);
			}
		}
	};

	// Parse expression
	function parseExpression(str) {
		var expr = parse('(' + str + ')');
		expr = expr.program.body[0].expression;
		babel.traverse.removeProperties(expr);
		return expr;
	}

	/*
  Extend the react
  */
	function reactExtend(path, attrs, opts) {
		// Attrs
		if (!t.isObjectExpression(attrs)) return;

		//
		var utils = extend({}, UTILS, opts && opts.utils);
		for (var key in utils) {
			utils[key] = parseExpression(utils[key]);
		}var templates = [];
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

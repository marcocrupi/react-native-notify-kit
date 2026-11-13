'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.ensureNotifeeExtensionFlag = ensureNotifeeExtensionFlag;
const child_process_1 = require('child_process');
// Keep the Expo/CLI copies identical: each is shipped through a separate build.
// Parse, never execute, consumer Ruby. A line scanner cannot distinguish a
// top-level assignment from continuations, interpolation, heredocs or blocks.
const FLAG_PREFLIGHT = String.raw`
require 'ripper'
require 'json'
source = STDIN.read
ast = Ripper.sexp(source)
def walk(node, &block)
  return unless node.is_a?(Array)
  yield node
  node.each { |child| walk(child, &block) if child.is_a?(Array) }
end
def flag_tokens(node)
  tokens = []
  walk(node) { |part| tokens << part if part[0] == :@gvar && part[1] == '$NotifeeExtension' }
  tokens
end
def evaluation?(node)
  found = false
  walk(node) do |part|
    if [:@ident, :@const].include?(part[0]) &&
        %w[target abstract_target pod podspec use_native_modules! use_expo_modules! use_react_native! Specification eval instance_eval class_eval module_eval from_file from_string].include?(part[1])
      found = true
    end
    found = true if part[0] == :@tstring_content && part[1].include?('.podspec')
  end
  found
end
# Only a bounded prelude is provably safe before an existing true flag. Unknown
# helpers and dynamic dispatch can evaluate podspecs even without a named call.
def literal?(node)
  return true if node.nil? || node == false
  return false unless node.is_a?(Array)
  return node.all? { |part| literal?(part) } unless node[0].is_a?(Symbol)
  case node[0]
  when :@int, :@float, :@rational, :@imaginary, :@tstring_content, :@label, :@ident
    true
  when :@kw
    %w[true false nil].include?(node[1])
  when :var_ref, :string_literal, :string_content, :symbol_literal, :symbol,
       :array, :hash, :assoclist_from_args, :assoc_new, :args_add_block, :arg_paren
    node.drop(1).all? { |part| literal?(part) }
  else
    false
  end
end
def safe_prelude?(node)
  return true if node[0] == :void_stmt
  if node[0] == :assign
    lhs = node[1]
    return lhs && lhs[0] == :var_field &&
      [:@ident, :@gvar, :@ivar, :@cvar, :@const].include?(lhs[1][0]) && literal?(node[2])
  end
  allowed = %w[require require_relative platform source project workspace install! use_frameworks!]
  if node[0] == :command
    return allowed.include?(node[1][1]) && literal?(node[2])
  end
  if node[0] == :method_add_arg && node[1][0] == :fcall
    return allowed.include?(node[1][1][1]) && literal?(node[2])
  end
  false
end
unless ast
  puts JSON.generate({ error: 'Ruby syntax could not be parsed', line: 1 })
  exit
end
has_eval = false
flag_text = nil
walk(ast) do |part|
  has_eval = true if part[0] == :@ident && %w[eval instance_eval class_eval module_eval].include?(part[1])
  flag_text ||= part if part[0] == :@tstring_content && part[1].include?('$NotifeeExtension')
end
if has_eval && flag_text
  puts JSON.generate({ error: 'dynamic Ruby evaluation mentions the flag', line: flag_text[2][0] })
  exit
end
all = flag_tokens(ast)
accepted = []
evaluating = false
error = nil
(ast[1] || []).each do |statement|
  tokens = flag_tokens(statement)
  unless tokens.empty?
    lhs = statement[1] if statement[0] == :assign
    rhs = statement[2] if statement[0] == :assign
    literal_true = lhs && lhs[0] == :var_field && lhs[1][0] == :@gvar &&
      lhs[1][1] == '$NotifeeExtension' && rhs && rhs[0] == :var_ref && rhs[1][0] == :@kw && rhs[1][1] == 'true'
    if !literal_true || tokens.length != 1
      error = { error: 'conflicting or ambiguous configuration; only unconditional literal true is supported', line: tokens[0][2][0] }
      break
    end
    if evaluating && accepted.empty?
      error = { error: 'assignment follows possible target/autolinking or podspec evaluation', line: tokens[0][2][0] }
      break
    end
    accepted.concat(tokens)
  end
  evaluating ||= evaluation?(statement) || !safe_prelude?(statement)
end
puts JSON.generate(error || { assigned: !accepted.empty?, references: all.length })
`;
function ensureNotifeeExtensionFlag(contents) {
  if (contents.includes('$NotifeeExtension')) {
    let result;
    try {
      result = JSON.parse(
        (0, child_process_1.execFileSync)('ruby', ['-e', FLAG_PREFLIGHT], {
          input: contents,
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: 16 * 1024 * 1024,
        }),
      );
    } catch {
      throw new Error(
        'NotifyKit NSE: $NotifeeExtension at line 1: Ruby (Ripper) preflight unavailable. ' +
          'Use the Ruby toolchain required by CocoaPods; no changes were written.',
      );
    }
    if (result.error) {
      throw new Error(
        `NotifyKit NSE: $NotifeeExtension at line ${result.line}: ${result.error}. ` +
          'Set $NotifeeExtension = true in the Podfile header before autolinking; no changes were written.',
      );
    }
    if (result.assigned) return contents;
  }
  // Insert after Ruby's shebang, magic comments and other leading comments.
  // Keep every original byte, including a BOM and a header without final LF.
  const bom = contents.startsWith('\uFEFF') ? '\uFEFF' : '';
  const text = contents.slice(bom.length);
  const lines = text.split('\n');
  let headerEnd = 0;
  let blockComment = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^=begin(?:\s|$)/.test(line)) blockComment = true;
    if (!blockComment && !/^\s*(?:#.*)?$/.test(line)) break;
    headerEnd += line.length + (index < lines.length - 1 ? 1 : 0);
    if (/^=end(?:\s|$)/.test(line)) blockComment = false;
  }
  const separator = headerEnd > 0 && text[headerEnd - 1] !== '\n' ? '\n' : '';
  return (
    bom +
    text.slice(0, headerEnd) +
    separator +
    '$NotifeeExtension = true\n' +
    text.slice(headerEnd)
  );
}

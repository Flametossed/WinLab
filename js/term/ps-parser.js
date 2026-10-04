/* PowerShell parser: source text -> AST for ps-runtime.js.
 * Covers the language students use at a console: pipelines, commands with -Param / -Param:value / positional
 * args / splatting, expressions with PowerShell precedence, variables ($x, $env:X, ${x}, $_), strings (single,
 * double with $var / $(...) / backtick escapes, here-strings), arrays, @(), $(), @{} hashtables, script blocks,
 * casts and [Type]::Member, member access / method calls / indexing, assignments (= += -= *= /=),
 * if/elseif/else, foreach, for, while, do, function (with param()), try/catch/finally, return/break/continue/exit/throw.
 * Errors are WS.ps.ParseError with PowerShell's message and error id; incomplete input (open brace, quote...)
 * sets .incomplete so the console can show a ">>" continuation prompt.
 * WS.ps.highlight(line) gives PSReadLine-style colouring for the input line. */
(function () {
  'use strict';
  const WS = window.WS;

  class ParseError extends Error {
    constructor(message, pos, id, incomplete) { super(message); this.pos = pos; this.id = id || 'ParseError'; this.incomplete = !!incomplete; }
  }

  const DASH_OPS = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'like', 'notlike', 'match', 'notmatch', 'contains', 'notcontains', 'in', 'notin', 'replace', 'split', 'join', 'is', 'isnot', 'as'];
  const CASE_OPS = new Set(DASH_OPS.filter(o => !['is', 'isnot', 'as', 'join'].includes(o)));
  const KEYWORDS = new Set(['if', 'elseif', 'else', 'foreach', 'for', 'while', 'do', 'until', 'function', 'filter', 'return', 'break', 'continue', 'exit', 'throw', 'try', 'catch', 'finally', 'param', 'begin', 'process', 'end', 'switch', 'in']);
  const isIdent = c => !!c && /[A-Za-z0-9_]/.test(c);
  const isIdentStart = c => !!c && /[A-Za-z_]/.test(c);
  const isWs = c => c === ' ' || c === '\t';
  const NUM_RE = /^(0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)(kb|mb|gb|tb|pb)?[ld]?$/i;
  const MULT = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5 };
  function toNumber(text) {
    const m = String(text).match(NUM_RE);
    if (!m) return NaN;
    const v = /^0x/i.test(m[1]) ? parseInt(m[1], 16) : parseFloat(m[1]);
    return m[2] ? v * MULT[m[2].toLowerCase()] : v;
  }

  class Parser {
    constructor(src) { this.s = src; this.i = 0; }
    peek(n = 0) { return this.s[this.i + n]; }
    eof() { return this.i >= this.s.length; }
    rest() { return this.s.slice(this.i); }
    err(msg, id, pos, incomplete) { throw new ParseError(msg, pos == null ? this.i : pos, id, incomplete); }

    /** Skip blanks, comments and line continuations; with nl also newlines. */
    ws(nl) {
      for (;;) {
        const c = this.peek();
        if (isWs(c) || c === '\r') { this.i++; continue; }
        if (c === '`' && (this.peek(1) === '\n' || (this.peek(1) === '\r' && this.peek(2) === '\n'))) { this.i += this.peek(1) === '\r' ? 3 : 2; continue; }
        if (c === '#') { while (!this.eof() && this.peek() !== '\n') this.i++; continue; }
        if (c === '<' && this.peek(1) === '#') {
          const end = this.s.indexOf('#>', this.i + 2);
          if (end < 0) this.err('Missing the closing #> for the block comment.', 'MissingEndOfBlockComment', this.i, true);
          this.i = end + 2; continue;
        }
        if (nl && c === '\n') { this.i++; continue; }
        break;
      }
    }
    /** The word at the cursor (letters/digits/_ and '-'), without consuming it. */
    word() { const m = this.rest().match(/^[A-Za-z_][\w-]*/); return m ? m[0] : ''; }
    kw(name) {
      const w = this.rest().match(/^[A-Za-z]+/);
      return w && w[0].toLowerCase() === name && !isIdent(this.peek(name.length)) && this.peek(name.length) !== '-';
    }
    expect(ch, msg, id) {
      this.ws(true);
      if (this.peek() !== ch) this.err(msg, id, this.i, this.eof());
      this.i++;
    }

    /* ================================================================ statements */
    script() {
      const start = this.i;
      const params = this.paramBlockIf();
      const statements = this.statementList(null);
      return { type: 'Script', statements, params, start, end: this.i };
    }
    statementList(term) {
      const out = [];
      for (;;) {
        this.ws(true);
        while (this.peek() === ';') { this.i++; this.ws(true); }
        if (this.eof()) {
          if (term === '}') this.err("Missing closing '}' in statement block or type definition.", 'MissingEndCurlyBrace', this.i, true);
          if (term === ')') this.err("Missing closing ')' in expression.", 'MissingEndParenthesisInExpression', this.i, true);
          break;
        }
        if (term && this.peek() === term) break;
        if (this.peek() === ')' || this.peek() === '}') this.err(`Unexpected token '${this.peek()}' in expression or statement.`, 'UnexpectedToken');
        out.push(this.statement());
        this.ws(false);
        const c = this.peek();
        if (this.eof() || c === '\n' || c === ';' || (term && c === term)) continue;
        if (c === '&' && this.peek(1) === '&') this.err("The token '&&' is not a valid statement separator in this version.", 'InvalidEndOfLine');
        if (c === '|' && this.peek(1) === '|') this.err("The token '||' is not a valid statement separator in this version.", 'InvalidEndOfLine');
        this.err(`Unexpected token '${this.tokenText()}' in expression or statement.`, 'UnexpectedToken');
      }
      return out;
    }
    tokenText() { const m = this.rest().match(/^("[^"]*"|'[^']*'|[^\s]+)/); return m ? m[0] : this.peek(); }

    statement() {
      this.ws(false);
      const start = this.i;
      if (this.kw('if')) return this.ifStmt();
      if (this.kw('foreach') && /^foreach\s*\(/i.test(this.rest())) return this.foreachStmt();
      if (this.kw('for') && /^for\s*\(/i.test(this.rest())) return this.forStmt();
      if (this.kw('while') && /^while\s*\(/i.test(this.rest())) return this.whileStmt();
      if (this.kw('do') && /^do\s*\{/i.test(this.rest())) return this.doStmt();
      if (this.kw('function') || this.kw('filter')) return this.functionDef();
      if (this.kw('try') && /^try\s*\{/i.test(this.rest())) return this.tryStmt();
      for (const k of ['return', 'exit', 'throw']) {
        if (this.kw(k)) {
          this.i += k.length; this.ws(false);
          const value = this.atStatementEnd() ? null : this.pipelineOrAssign();
          return { type: 'Flow', kind: k, value, start, end: this.i };
        }
      }
      for (const k of ['break', 'continue']) if (this.kw(k)) { this.i += k.length; return { type: 'Flow', kind: k, start, end: this.i }; }
      return this.pipelineOrAssign();
    }
    atStatementEnd() { const c = this.peek(); return this.eof() || c === '\n' || c === ';' || c === '}' || c === ')'; }
    block() {
      this.ws(true);
      if (this.peek() !== '{') this.err("Missing statement block.", 'MissingStatementBlock', this.i, this.eof());
      this.i++;
      const statements = this.statementList('}');
      this.i++;
      return { type: 'Block', statements };
    }
    condition(kwName) {
      this.ws(false);
      if (this.peek() !== '(') this.err(`Missing '(' after '${kwName}' in ${kwName} statement.`, 'MissingOpenParenthesisIn' + kwName[0].toUpperCase() + kwName.slice(1) + 'Statement', this.i, this.eof());
      this.i++;
      this.ws(true);
      const cond = this.pipelineOrAssign();
      this.expect(')', `Missing closing ')' after expression in '${kwName}' statement.`, 'MissingEndParenthesisAfterStatement');
      return cond;
    }
    ifStmt() {
      const start = this.i;
      const clauses = [];
      let elseBlock = null;
      this.i += 2;
      clauses.push({ cond: this.condition('if'), body: this.block() });
      for (;;) {
        const save = this.i;
        this.ws(true);
        if (this.kw('elseif')) { this.i += 6; clauses.push({ cond: this.condition('elseif'), body: this.block() }); continue; }
        if (this.kw('else')) { this.i += 4; elseBlock = this.block(); break; }
        this.i = save;
        break;
      }
      return { type: 'If', clauses, elseBlock, start, end: this.i };
    }
    foreachStmt() {
      const start = this.i;
      this.i += 7; this.ws(false); this.i++; this.ws(true);
      if (this.peek() !== '$') this.err("Missing variable name after foreach.", 'MissingVariableNameAfterForeach');
      this.i++;
      const name = this.varName();
      this.ws(true);
      if (!this.kw('in')) this.err("Missing 'in' after variable in foreach loop.", 'MissingInInForeach', this.i, this.eof());
      this.i += 2; this.ws(true);
      const collection = this.pipelineOrAssign();
      this.expect(')', "Missing closing ')' after expression in 'foreach' statement.", 'MissingEndParenthesisAfterForeach');
      const body = this.block();
      return { type: 'Foreach', variable: name, collection, body, start, end: this.i };
    }
    forStmt() {
      const start = this.i;
      this.i += 3; this.ws(false); this.i++;
      const part = term => { this.ws(true); if (this.peek() === term) return null; const p = this.pipelineOrAssign(); this.ws(true); return p; };
      const init = part(';'); this.expect(';', "Missing ';' in for statement.", 'MissingSemicolonInFor');
      const cond = part(';'); this.expect(';', "Missing ';' in for statement.", 'MissingSemicolonInFor');
      const step = part(')'); this.expect(')', "Missing closing ')' after expression in 'for' statement.", 'MissingEndParenthesisAfterFor');
      return { type: 'For', init, cond, step, body: this.block(), start, end: this.i };
    }
    whileStmt() {
      const start = this.i;
      this.i += 5;
      const cond = this.condition('while');
      return { type: 'While', cond, body: this.block(), start, end: this.i };
    }
    doStmt() {
      const start = this.i;
      this.i += 2;
      const body = this.block();
      this.ws(true);
      let until = false;
      if (this.kw('while')) this.i += 5; else if (this.kw('until')) { this.i += 5; until = true; } else this.err("Missing while or until keyword in do loop.", 'MissingWhileOrUntilInDoWhile', this.i, this.eof());
      const cond = this.condition(until ? 'until' : 'while');
      return { type: 'Do', body, cond, until, start, end: this.i };
    }
    functionDef() {
      const start = this.i;
      this.i += this.kw('filter') ? 6 : 8;
      this.ws(false);
      const m = this.rest().match(/^[\w-]+/);
      if (!m) this.err('Missing function name.', 'MissingNameAfterKeyword', this.i, this.eof());
      this.i += m[0].length;
      this.ws(false);
      let params = [];
      if (this.peek() === '(') { this.i++; params = this.paramList(')'); }
      this.ws(true);
      if (this.peek() !== '{') this.err('Missing function body in function declaration.', 'MissingFunctionBody', this.i, this.eof());
      const body = this.scriptBlock();
      if (!params.length && body.params) params = body.params;
      return { type: 'Function', name: m[0], params, body, start, end: this.i };
    }
    tryStmt() {
      const start = this.i;
      this.i += 3;
      const body = this.block();
      const catches = [];
      let fin = null;
      for (;;) {
        const save = this.i;
        this.ws(true);
        if (this.kw('catch')) {
          this.i += 5; this.ws(false);
          const types = [];
          while (this.peek() === '[') { const e = this.s.indexOf(']', this.i); types.push(this.s.slice(this.i + 1, e)); this.i = e + 1; this.ws(false); if (this.peek() === ',') { this.i++; this.ws(false); } }
          catches.push({ types, body: this.block() });
          continue;
        }
        if (this.kw('finally')) { this.i += 7; fin = this.block(); break; }
        this.i = save;
        break;
      }
      if (!catches.length && !fin) this.err('The Try statement is missing its Catch or Finally block.', 'MissingCatchOrFinally', this.i, this.eof());
      return { type: 'Try', body, catches, fin, start, end: this.i };
    }
    paramBlockIf() {
      const save = this.i;
      this.ws(true);
      // attributes like [CmdletBinding()] may precede param()
      while (this.peek() === '[') { const e = this.matchBracket(this.i); this.i = e + 1; this.ws(true); }
      if (this.kw('param') && /^param\s*\(/i.test(this.rest())) {
        this.i += 5; this.ws(false); this.i++;
        return this.paramList(')');
      }
      this.i = save;
      return null;
    }
    paramList(term) {
      const params = [];
      for (;;) {
        this.ws(true);
        if (this.peek() === term) { this.i++; break; }
        if (this.eof()) this.err(`Missing closing '${term}' in parameter list.`, 'MissingEndParenthesisInFunctionParameterList', this.i, true);
        let type = null, mandatory = false;
        while (this.peek() === '[') {
          const e = this.matchBracket(this.i);
          const inner = this.s.slice(this.i + 1, e);
          if (/^parameter\s*\(/i.test(inner)) { if (/mandatory/i.test(inner) && !/mandatory\s*=\s*\$false/i.test(inner)) mandatory = true; }
          else if (!/^\w+\s*\(/.test(inner)) type = inner.trim();
          this.i = e + 1; this.ws(true);
        }
        if (this.peek() !== '$') this.err('Missing variable name in parameter list.', 'InvalidFunctionParameter');
        this.i++;
        const name = this.varName();
        this.ws(true);
        let def = null;
        if (this.peek() === '=') { this.i++; this.ws(true); def = this.expression(); }
        params.push({ name, type, mandatory, def });
        this.ws(true);
        if (this.peek() === ',') this.i++;
      }
      return params;
    }
    matchBracket(at) {
      let depth = 0;
      for (let j = at; j < this.s.length; j++) {
        if (this.s[j] === '[') depth++;
        else if (this.s[j] === ']') { depth--; if (!depth) return j; }
      }
      this.err("Missing ']' after array index expression.", 'MissingEndSquareBracket', at, true);
    }

    /* ================================================================ pipelines */
    pipelineOrAssign() {
      this.ws(false);
      const start = this.i;
      if (this.peek() === '$' || this.peek() === '[' || this.peek() === '(') {
        try {
          const lhs = this.unary();
          this.ws(false);
          const m = this.rest().match(/^(=(?!=)|\+=|-=|\*=|\/=)/);
          // (Get-Process notepad).PriorityClass = 'High': a property of a parenthesized expression can be assigned too
          if (m && (['Var', 'Member', 'Index', 'Cast'].includes(lhs.type) && (this.s[start] !== '(' || lhs.type === 'Member' || lhs.type === 'Index'))) {
            this.i += m[0].length;
            this.ws(true);
            const value = this.statement();
            return { type: 'Assign', target: lhs, op: m[0], value, start, end: this.i };
          }
        } catch (e) { if (!(e instanceof ParseError) || e.incomplete) throw e; }
        this.i = start;
      }
      return this.pipeline();
    }
    pipeline() {
      const start = this.i;
      const elements = [];
      const redirs = [];
      for (;;) {
        this.ws(false);
        if (this.peek() === '|' || this.atStatementEnd()) {
          this.err(elements.length ? 'An empty pipe element is not allowed.' : 'An empty pipe element is not allowed.', 'EmptyPipeElement', this.i, this.eof() && elements.length > 0);
        }
        elements.push(this.element(elements.length === 0));
        this.ws(false);
        this.redirections(redirs);
        if (this.peek() === '|' && this.peek(1) !== '|') { this.i++; this.ws(true); if (this.eof()) this.err('An empty pipe element is not allowed.', 'EmptyPipeElement', this.i, true); continue; }
        break;
      }
      return { type: 'Pipeline', elements, redirs, start, end: this.i, text: this.s.slice(start, this.i).trim() };
    }
    redirections(redirs) {
      for (;;) {
        this.ws(false);
        const m = this.rest().match(/^([1-6*]?)(>>?)(&1)?/);
        if (!m || (m[1] === '' && m[0] === '')) return;
        if (!m[0] || !/>/.test(m[0])) return;
        this.i += m[0].length;
        const stream = m[1] || '1';
        if (m[3]) { redirs.push({ stream, merge: true }); continue; }
        this.ws(false);
        const target = this.argPrimary();
        redirs.push({ stream, append: m[2] === '>>', target });
      }
    }
    element(first) {
      this.ws(false);
      const c = this.peek();
      const start = this.i;
      const cmdStart = isIdentStart(c) || /[\\À-￿]/.test(c || '') || c === '&' ||
        (c === '.' && (isWs(this.peek(1)) || this.peek(1) === '\\' || this.peek(1) === '/' || (this.peek(1) === '.' && this.peek(2) === '\\'))) ||
        (!first && (c === '?' || c === '%') && (isWs(this.peek(1)) || this.peek(1) === '{'));
      if (cmdStart) return this.command();
      const expr = this.expression();
      return { type: 'ExprElement', expr, start, end: this.i };
    }
    command() {
      const start = this.i;
      let name = null, nameExpr = null, dot = false;
      if (this.peek() === '&') { this.i++; this.ws(false); nameExpr = this.argPrimary(); }
      else if (this.peek() === '.' && isWs(this.peek(1))) { this.i++; this.ws(false); nameExpr = this.argPrimary(); dot = true; }
      else {
        const m = this.rest().match(/^[^\s|;(){}&,"'<>]+/);
        name = m[0];
        this.i += name.length;
      }
      const args = [];
      let noMoreParams = false;
      for (;;) {
        this.ws(false);
        const c = this.peek();
        if (this.eof() || c === '|' || c === ';' || c === '\n' || c === ')' || c === '}') break;
        if (c === '&' && this.peek(1) === '&') break;
        if (/^[1-6*]?>/.test(this.rest())) break;
        const aStart = this.i;
        if (!noMoreParams && c === '-' && /[A-Za-z_?]/.test(this.peek(1) || '')) {
          this.i++;
          const pm = this.rest().match(/^[\w?]+/);
          const pname = pm[0];
          this.i += pname.length;
          if (this.peek() === ':') {
            this.i++;
            args.push({ kind: 'param', name: pname, value: this.commandArg(), explicit: true, start: aStart, end: this.i });
          } else args.push({ kind: 'param', name: pname, start: aStart, end: this.i });
          continue;
        }
        if (!noMoreParams && c === '-' && this.peek(1) === '-' && (isWs(this.peek(2)) || this.peek(2) == null)) { this.i += 2; noMoreParams = true; continue; }
        if (c === '@' && isIdentStart(this.peek(1))) { this.i++; args.push({ kind: 'splat', name: this.varName(), start: aStart, end: this.i }); continue; }
        args.push({ kind: 'arg', value: this.commandArg(), start: aStart, end: this.i });
      }
      return { type: 'Command', name, nameExpr, dot, args, start, end: this.i, text: this.s.slice(start, this.i).trim() };
    }
    commandArg() {
      const items = [this.argPrimary()];
      for (;;) {
        const save = this.i;
        while (isWs(this.peek())) this.i++;
        if (this.peek() === ',') { this.i++; this.ws(true); items.push(this.argPrimary()); continue; }
        this.i = save;
        break;
      }
      return items.length === 1 ? items[0] : { type: 'Array', items };
    }
    argPrimary() {
      const c = this.peek();
      if (c === '"' || c === "'") return this.postfix(this.string());
      if (c === '@' && (this.peek(1) === '"' || this.peek(1) === "'")) return this.hereString();
      if (c === '$' || c === '(' || (c === '@' && (this.peek(1) === '(' || this.peek(1) === '{'))) return this.postfix(this.primary());
      if (c === '{') return this.scriptBlock();
      if (c === '[' && /^\[[\w.\[\]]+\]::/.test(this.rest())) return this.postfix(this.primary());
      // bareword (may be a number like 20GB, or contain $variables)
      const m = this.rest().match(/^[^\s|;(){},&]+/);
      if (!m) this.err(`Unexpected token '${c}' in expression or statement.`, 'UnexpectedToken');
      let text = m[0];
      // a trailing ">" belongs to a redirection
      const r = text.search(/[1-6*]?>/);
      if (r > 0) text = text.slice(0, r);
      const start = this.i;
      this.i += text.length;
      if (NUM_RE.test(text) || /^[+-]\d/.test(text) && NUM_RE.test(text.slice(1))) {
        const v = /^[+-]/.test(text) ? (text[0] === '-' ? -1 : 1) * toNumber(text.slice(1)) : toNumber(text);
        return { type: 'Literal', value: v, bare: text };
      }
      if (text.includes('$')) return { type: 'String', parts: new Parser(text).dqContent(null, start), bare: true };
      return { type: 'Literal', value: text, bare: true };
    }

    /* ================================================================ expressions */
    expression() { return this.logical(); }
    dashOp(list) {
      if (this.peek() !== '-') return null;
      const m = this.rest().match(/^-([a-z]+)/i);
      if (!m) return null;
      const w = m[1].toLowerCase();
      const base = /^[ci]/.test(w) && CASE_OPS.has(w.slice(1)) ? w.slice(1) : w;
      if (!list.includes(base)) return null;
      if (isIdent(this.peek(m[0].length))) return null;
      this.i += m[0].length;
      return { op: base, cs: w[0] === 'c' && w !== base };
    }
    binLoop(next, ops, symbolic) {
      let left = next();
      for (;;) {
        const save = this.i;
        while (isWs(this.peek())) this.i++;
        let op = null, cs = false;
        if (symbolic) {
          for (const s of symbolic) if (this.rest().startsWith(s) && !(s === '-' && /^-[a-z]/i.test(this.rest())) && !(this.rest().startsWith(s + '=')) && !(s === '-' && this.peek(1) === '-')) { op = s; this.i += s.length; break; }
        }
        if (!op && ops) { const d = this.dashOp(ops); if (d) { op = d.op; cs = d.cs; } }
        if (!op) { this.i = save; return left; }
        this.ws(true);
        if (this.atStatementEnd() || this.peek() === '|') this.err(`You must provide a value expression following the '${symbolic && symbolic.includes(op) ? op : '-' + op}' operator.`, 'ExpectedValueExpression', this.i, this.eof());
        const right = next();
        left = { type: 'Binary', op, cs, left, right };
      }
    }
    logical() { return this.binLoop(() => this.comparison(), ['and', 'or', 'xor']); }
    comparison() { return this.binLoop(() => this.bitwise(), DASH_OPS); }
    bitwise() { return this.binLoop(() => this.additive(), ['band', 'bor', 'bxor']); }
    additive() { return this.binLoop(() => this.multiplicative(), null, ['+', '-']); }
    multiplicative() { return this.binLoop(() => this.format(), null, ['*', '/', '%']); }
    format() { return this.binLoop(() => this.range(), ['f']); }
    range() {
      const left = this.arrayExpr();
      if (this.peek() === '.' && this.peek(1) === '.') { this.i += 2; return { type: 'Range', from: left, to: this.arrayExpr() }; }
      return left;
    }
    arrayExpr() {
      const first = this.unary();
      const items = [first];
      for (;;) {
        const save = this.i;
        while (isWs(this.peek())) this.i++;
        if (this.peek() === ',') { this.i++; this.ws(true); items.push(this.unary()); continue; }
        this.i = save;
        break;
      }
      return items.length === 1 ? first : { type: 'Array', items };
    }
    unary() {
      this.ws(false);
      const c = this.peek();
      if (c === '!') { this.i++; this.ws(false); return { type: 'Unary', op: 'not', operand: this.unary() }; }
      if (c === '-') {
        const d = this.rest().match(/^-(not|bnot|split|join)\b/i);
        if (d) { this.i += d[0].length; this.ws(false); return { type: 'Unary', op: d[1].toLowerCase(), operand: this.unary() }; }
        if (this.peek(1) === '-' && this.peek(2) === '$') { this.i += 2; return { type: 'PreInc', op: '--', operand: this.unary() }; }
        if (/[\d.$(\[]/.test(this.peek(1) || '')) { this.i++; return { type: 'Unary', op: 'neg', operand: this.unary() }; }
      }
      if (c === '+' && this.peek(1) === '+' && this.peek(2) === '$') { this.i += 2; return { type: 'PreInc', op: '++', operand: this.unary() }; }
      if (c === '+' && /[\d$(]/.test(this.peek(1) || '')) { this.i++; return { type: 'Unary', op: 'pos', operand: this.unary() }; }
      if (c === '[') {
        const e = this.matchBracket(this.i);
        const typeName = this.s.slice(this.i + 1, e).trim();
        if (this.s.slice(e + 1, e + 3) !== '::' && /^[\w.]+(\[\])?$/.test(typeName)) {
          this.i = e + 1;
          this.ws(false);
          if (this.atStatementEnd() || this.peek() === '|' || this.peek() === ',') return { type: 'TypeLit', name: typeName };
          return { type: 'Cast', typeName, expr: this.unary() };
        }
      }
      const p = this.postfix(this.primary());
      if ((this.peek() === '+' && this.peek(1) === '+') || (this.peek() === '-' && this.peek(1) === '-' && !isIdent(this.peek(2)))) {
        if (p.type === 'Var' || p.type === 'Member' || p.type === 'Index') { const op = this.peek() + this.peek(); this.i += 2; return { type: 'PostInc', op, operand: p }; }
      }
      return p;
    }
    postfix(e) {
      for (;;) {
        const c = this.peek();
        if (c === '.' && this.peek(1) !== '.' && (isIdentStart(this.peek(1)) || this.peek(1) === '"' || this.peek(1) === "'" || this.peek(1) === '$')) {
          this.i++;
          e = this.member(e, false);
          continue;
        }
        if (c === ':' && this.peek(1) === ':') { this.i += 2; e = this.member(e, true); continue; }
        if (c === '[' && e.type !== 'TypeLit') {
          this.i++;
          this.ws(true);
          const index = this.expression();
          this.expect(']', "Missing ']' after array index expression.", 'MissingEndSquareBracket');
          e = { type: 'Index', obj: e, index };
          continue;
        }
        return e;
      }
    }
    member(obj, isStatic) {
      let name;
      if (this.peek() === '"' || this.peek() === "'") name = this.string();
      else if (this.peek() === '$') { this.i++; name = { type: 'Var', name: this.varName() }; }
      else { const m = this.rest().match(/^\w+/); name = m[0]; this.i += name.length; }
      if (this.peek() === '(') {
        this.i++;
        const args = [];
        this.ws(true);
        if (this.peek() !== ')') {
          for (;;) {
            this.ws(true);
            args.push(this.logical());
            this.ws(true);
            if (this.peek() === ',') { this.i++; continue; }
            break;
          }
        }
        this.expect(')', "Missing closing ')' in method call.", 'MissingEndParenthesisInMethodCall');
        return { type: 'Invoke', obj, name, args, isStatic };
      }
      return { type: 'Member', obj, name, isStatic };
    }
    varName() {
      if (this.peek() === '{') {
        const e = this.s.indexOf('}', this.i);
        if (e < 0) this.err("Missing '}' in variable reference.", 'MissingEndCurlyBrace', this.i, true);
        const n = this.s.slice(this.i + 1, e); this.i = e + 1; return n;
      }
      const c = this.peek();
      if (c === '_' && !isIdent(this.peek(1))) { this.i++; return '_'; }
      if (c === '?' || c === '$' || c === '^') { this.i++; return c; }
      const m = this.rest().match(/^(?:(global|script|local|private|env|variable|function|alias):)?[\w]+/i);
      if (!m) this.err("Variable reference is not valid. '$' was not followed by a valid variable name character. Consider using ${} to delimit the name.", 'InvalidVariableReference');
      this.i += m[0].length;
      return m[0];
    }
    primary() {
      this.ws(false);
      const c = this.peek();
      const start = this.i;
      if (c === '$') {
        if (this.peek(1) === '(') { this.i += 2; const statements = this.statementList(')'); this.i++; return { type: 'SubExpr', statements }; }
        this.i++;
        return { type: 'Var', name: this.varName(), start };
      }
      if (c === '@') {
        if (this.peek(1) === '(') { this.i += 2; const statements = this.statementList(')'); this.i++; return { type: 'ArraySub', statements }; }
        if (this.peek(1) === '{') return this.hashtable();
        if (this.peek(1) === '"' || this.peek(1) === "'") return this.hereString();
      }
      if (c === '(') {
        this.i++;
        this.ws(true);
        if (this.peek() === ')') { this.i++; return { type: 'Literal', value: null }; }
        const inner = this.pipelineOrAssign();
        this.ws(true);
        if (this.peek() !== ')') this.err("Missing closing ')' in expression.", 'MissingEndParenthesisInExpression', this.i, this.eof());
        this.i++;
        return { type: 'Paren', inner };
      }
      if (c === '"' || c === "'") return this.string();
      if (c === '{') return this.scriptBlock();
      if (c === '[') {
        const e = this.matchBracket(this.i);
        const name = this.s.slice(this.i + 1, e).trim();
        this.i = e + 1;
        return { type: 'TypeLit', name };
      }
      const num = this.rest().match(/^(0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)(kb|mb|gb|tb|pb)?[ld]?(?![\w])/i);
      if (num) { this.i += num[0].length; return { type: 'Literal', value: toNumber(num[0].replace(/[ld]$/i, '')) }; }
      if (this.eof()) this.err('You must provide a value expression.', 'ExpectedExpression', this.i, true);
      this.err(`Unexpected token '${this.tokenText()}' in expression or statement.`, 'UnexpectedToken');
    }
    hashtable() {
      this.i += 2;
      const entries = [];
      for (;;) {
        this.ws(true);
        while (this.peek() === ';') { this.i++; this.ws(true); }
        if (this.peek() === '}') { this.i++; break; }
        if (this.eof()) this.err('The hash literal was incomplete.', 'IncompleteHashLiteral', this.i, true);
        let key;
        if (this.peek() === '"' || this.peek() === "'") key = this.string();
        else if (this.peek() === '$' || this.peek() === '(') key = this.postfix(this.primary());
        else { const m = this.rest().match(/^[^\s=;}]+/); key = { type: 'Literal', value: m[0] }; this.i += m[0].length; }
        this.ws(false);
        if (this.peek() !== '=') this.err("Missing '=' operator after key in hash literal.", 'MissingEqualsInHashLiteral', this.i, this.eof());
        this.i++;
        this.ws(true);
        const value = this.statement();
        entries.push({ key, value });
      }
      return { type: 'Hash', entries };
    }
    scriptBlock() {
      const start = this.i;
      this.i++;
      const params = this.paramBlockIf();
      const statements = this.statementList('}');
      this.i++;
      return { type: 'ScriptBlock', statements, params, text: this.s.slice(start + 1, this.i - 1) };
    }
    string() {
      const q = this.peek();
      const start = this.i;
      this.i++;
      if (q === "'") {
        let out = '';
        for (;;) {
          if (this.eof()) this.err("The string is missing the terminator: '.", 'TerminatorExpectedAtEndOfString', start, true);
          const ch = this.peek();
          if (ch === "'" || ch === '’') { if (this.peek(1) === "'") { out += "'"; this.i += 2; continue; } this.i++; break; }
          out += ch; this.i++;
        }
        return { type: 'Literal', value: out, quoted: true };
      }
      const parts = this.dqContent('"', start);
      return parts.every(p => typeof p === 'string') ? { type: 'Literal', value: parts.join(''), quoted: true } : { type: 'String', parts };
    }
    hereString() {
      const q = this.peek(1);
      const start = this.i;
      this.i += 2;
      const nl = this.s.indexOf('\n', this.i);
      if (nl < 0) this.err('No characters are allowed after a here-string header but before the end of the line.', 'UnexpectedCharactersAfterHereStringHeader', start, true);
      this.i = nl + 1;
      const endRe = q === '"' ? /\n"@/ : /\n'@/;
      const rest = this.s.slice(this.i - 1);
      const m = rest.match(endRe);
      if (!m) this.err(`The string is missing the terminator: ${q}@.`, 'TerminatorExpectedAtEndOfString', start, true);
      const body = this.s.slice(this.i, this.i - 1 + m.index);
      this.i = this.i - 1 + m.index + 3;
      if (q === "'") return { type: 'Literal', value: body, quoted: true };
      const parts = new Parser(body).dqContent(null, start);
      return parts.every(p => typeof p === 'string') ? { type: 'Literal', value: parts.join(''), quoted: true } : { type: 'String', parts };
    }
    /** Contents of a double-quoted string (or an expandable bareword when end is null). */
    dqContent(end, start) {
      const parts = [];
      let buf = '';
      const ESC = { n: '\n', r: '\r', t: '\t', 0: '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v' };
      for (;;) {
        if (this.eof()) {
          if (end) this.err(`The string is missing the terminator: ${end}.`, 'TerminatorExpectedAtEndOfString', start, true);
          break;
        }
        const ch = this.peek();
        if (end && (ch === '"' || ch === '”' || ch === '“')) {
          if (this.peek(1) === '"') { buf += '"'; this.i += 2; continue; }
          this.i++; break;
        }
        if (ch === '`') { const n = this.peek(1); buf += n in ESC ? ESC[n] : (n || ''); this.i += 2; continue; }
        if (ch === '$') {
          const n = this.peek(1);
          if (n === '(') {
            if (buf) { parts.push(buf); buf = ''; }
            this.i += 2;
            const statements = this.statementList(')');
            this.i++;
            parts.push({ type: 'SubExpr', statements });
            continue;
          }
          if (n && (isIdentStart(n) || n === '{' || n === '_' || n === '?' || n === '$')) {
            if (buf) { parts.push(buf); buf = ''; }
            this.i++;
            parts.push({ type: 'Var', name: this.varName() });
            continue;
          }
        }
        buf += ch; this.i++;
      }
      if (buf || !parts.length) parts.push(buf);
      return parts;
    }
  }

  function parse(src) {
    const p = new Parser(String(src).replace(/\r\n/g, '\n'));
    const ast = p.script();
    return ast;
  }

  /** PSReadLine default colours for the line being typed. */
  function highlight(line) {
    const out = [];
    const push = (text, fg) => { if (text) out.push({ text, fg }); };
    let i = 0, expectCmd = true;
    while (i < line.length) {
      const rest = line.slice(i);
      let m;
      if ((m = rest.match(/^\s+/))) { push(m[0]); i += m[0].length; if (m[0].includes('\n')) expectCmd = true; continue; }
      if ((m = rest.match(/^#.*/))) { push(m[0], 'DarkGreen'); i += m[0].length; continue; }
      if ((m = rest.match(/^'(?:[^']|'')*'?/))) { push(m[0], 'DarkCyan'); i += m[0].length; expectCmd = false; continue; }
      if ((m = rest.match(/^"(?:[^"`]|`.|"")*"?/))) { push(m[0], 'DarkCyan'); i += m[0].length; expectCmd = false; continue; }
      if ((m = rest.match(/^\$(\{[^}]*\}?|[\w:?_^$]+)/))) { push(m[0], 'Green'); i += m[0].length; expectCmd = false; continue; }
      if ((m = rest.match(/^[|;]/)) || (m = rest.match(/^[({]/))) { push(m[0], 'DarkGray'); i += 1; expectCmd = true; continue; }
      if ((m = rest.match(/^[)}=,+*\/%!<>\[\]]+/))) { push(m[0], 'DarkGray'); i += m[0].length; expectCmd = false; continue; }
      if ((m = rest.match(/^-[A-Za-z][\w:]*/))) {
        const op = m[0].slice(1).toLowerCase();
        push(m[0], DASH_OPS.includes(op.replace(/^[ci]/, '')) || ['and', 'or', 'not', 'f', 'xor'].includes(op) ? 'DarkGray' : 'DarkGray');
        i += m[0].length; continue;
      }
      if ((m = rest.match(/^\d[\w.]*/)) && !expectCmd) { push(m[0], 'White'); i += m[0].length; continue; }
      if ((m = rest.match(/^[^\s|;(){},=]+/))) {
        const w = m[0];
        if (KEYWORDS.has(w.toLowerCase()) && expectCmd) push(w, 'Green');
        else if (expectCmd) { push(w, 'Yellow'); expectCmd = false; }
        else push(w);
        i += w.length;
        continue;
      }
      push(line[i]); i++;
    }
    return out;
  }

  WS.ps = WS.ps || {};
  Object.assign(WS.ps, { parse, ParseError, highlight, toNumber, NUM_RE });
})();

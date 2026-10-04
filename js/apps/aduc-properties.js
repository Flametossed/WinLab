/* ADUC property sheets. Input stays in dialog drafts until Apply/OK; operations use WS.ad. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, I = WS.icons, F = WS.ui.f, A = WS.ad, D = WS.aduc;
  const header = o => h('div.aduc-header', h('span', { html: D.icon(o) }), o.name);
  const date = value => value ? new Date(value).toLocaleString() : 'Not set';

  function properties(identity, opts = {}) {
    const o = A.get(identity); if (!o) return null;
    const baseline = {}, controls = {}, tabs = [];
    let sheet;
    const text = (key, readOnly = false) => {
      baseline[key] = o[key] == null ? '' : String(o[key]);
      return controls[key] = D.field(key, F.text({ value: baseline[key], readOnly }));
    };
    const check = (key, label, value = o[key]) => {
      baseline[key] = !!value;
      return controls[key] = D.field(key, F.checkbox(label, baseline[key]));
    };
    const changes = keys => Object.fromEntries(keys.filter(k => controls[k] && (controls[k].input ? controls[k].checked : controls[k].value) !== baseline[k])
      .map(k => [k, controls[k].input ? controls[k].checked : controls[k].value]));
    const apply = keys => {
      const props = changes(keys);
      if (!Object.keys(props).length) return { ok: true };
      const r = A.setProps(o.id, props);
      if (r.ok) Object.assign(baseline, props);
      return r;
    };
    const attributes = (label, fields) => ({ label,
      render: () => h('div.aduc-form', ...fields.map(([key, name]) => F.row(name + ':', text(key), { labelWidth: 125 }))),
      apply: () => apply(fields.map(([key]) => key)) });

    function membership(kind) {
      const members = kind === 'members';
      const read = () => members ? A.members(o.id) : A.memberOf(o.id);
      let draft = read().map(x => x.id), saved = new Set(draft), primary = o.primaryGroupId, savedPrimary = primary;
      let list, primaryValue, removeBtn, primaryBtn;
      const selected = () => list.selected();
      const paintButtons = () => {
        const rows = selected();
        const isPrimary = x => members ? x.primaryGroupId === o.rid : x.rid === primary;
        if (removeBtn) removeBtn.disabled = !rows.length || rows.some(isPrimary);
        if (primaryBtn) primaryBtn.disabled = rows.length !== 1 || rows[0].rid === primary || rows[0].scope === 'DomainLocal' || rows[0].category !== 'Security';
      };
      const paint = () => {
        list.refresh(); paintButtons();
        if (primaryValue) {
          const g = A.search({ type: 'group' }).find(x => x.rid === primary);
          primaryValue.textContent = g ? g.name : '';
        }
      };
      const add = async () => {
        const picked = await WS.ui.objectPicker({ source: 'ad', types: members ? ['user', 'group', 'computer'] : ['group'], multi: true,
          filter: x => x.id !== o.id && !draft.includes(x.id) });
        if (!picked || !sheet.frame.shade.isConnected) return;
        for (const p of picked) if (!draft.includes(p.id)) draft.push(p.id);
        sheet.setDirty(); paint();
      };
      const remove = () => {
        if (removeBtn.disabled) return;
        const ids = new Set(selected().map(x => x.id));
        draft = draft.filter(id => !ids.has(id)); sheet.setDirty(); paint();
      };
      return { label: members ? 'Members' : 'Member Of', render: () => {
        list = WS.ui.listView({ columns: [{ key: 'name', label: 'Name', width: 190 },
          { key: 'folder', label: 'Active Directory Folder', width: 230, value: x => A.canonical(A.get(x.parentId) || x) }],
          rows: () => draft.map(id => A.get(id)).filter(Boolean), icon: D.icon, getId: x => x.id,
          multi: true, onSelect: paintButtons, onActivate: x => properties(x.id, opts),
          onKey: e => { if (e.key === 'Delete' && !removeBtn.disabled) { remove(); return true; } return false; } });
        list.el.classList.add('aduc-members'); list.el.setAttribute('data-nodirty', '');
        removeBtn = F.button('Remove', remove, { disabled: true });
        const buttons = h('div.aduc-buttons', F.button('Add...', add), removeBtn);
        const content = h('div.aduc-form', F.note(members ? 'Members:' : 'Member of:'), list.el, buttons);
        if (!members && ['user', 'computer'].includes(o.type)) {
          primaryValue = F.value((A.search({ type: 'group' }).find(g => g.rid === primary) || {}).name || '');
          primaryBtn = F.button('Set Primary Group', () => { const g = selected()[0]; if (!g || primaryBtn.disabled) return; primary = g.rid; sheet.setDirty(); paint(); }, { disabled: true });
          content.append(F.row('Primary group:', primaryValue), primaryBtn);
        }
        return content;
      }, apply: () => {
        for (const id of draft.filter(id => !saved.has(id))) {
          const r = members ? A.addMember(o.id, id) : A.addMember(id, o.id);
          if (!r.ok) return r;
          saved.add(id);
        }
        if (!members && primary !== savedPrimary) {
          const g = A.search({ type: 'group' }).find(x => x.rid === primary);
          const r = A.setPrimaryGroup(o.id, g && g.id);
          if (!r.ok) return r;
          savedPrimary = primary;
        }
        for (const id of [...saved].filter(id => !draft.includes(id))) {
          const r = members ? A.removeMember(o.id, id) : A.removeMember(id, o.id);
          if (!r.ok) return r;
          saved.delete(id);
        }
        paint(); return { ok: true };
      } };
    }

    function managedBy(key = 'managedBy') {
      let id = o[key] || null, saved = id;
      const name = D.field(key, F.text({ value: (A.get(id) || {}).name || '', readOnly: true }));
      const change = async () => {
        const picked = await WS.ui.objectPicker({ source: 'ad', types: ['user', 'group'], multi: false });
        if (!picked || !picked.length || !sheet.frame.shade.isConnected) return;
        id = picked[0].id; name.value = picked[0].name; sheet.setDirty();
      };
      return { label: 'Managed By', render: () => h('div.aduc-form', F.stack('Name:', h('div.aduc-manager', name,
        F.button('Change...', change), F.button('Clear', () => { id = null; name.value = ''; sheet.setDirty(); }))),
        F.note('Select the user or group responsible for this object.')),
        apply: () => { if (id === saved) return { ok: true }; const r = A.setProps(o.id, { [key]: id }); if (r.ok) saved = id; return r; } };
    }

    if (o.type === 'user') {
      tabs.push({ label: 'General', render: () => h('div.aduc-form', header(o),
        F.row('First name:', text('givenName')), F.row('Initials:', text('initials')), F.row('Last name:', text('sn')),
        F.row('Display name:', text('displayName')), F.row('Description:', text('description')), F.row('Office:', text('office')),
        F.row('Telephone number:', text('telephone')), F.row('E-mail:', text('email')), F.row('Web page:', text('webPage'))),
        apply: () => apply(['givenName', 'initials', 'sn', 'displayName', 'description', 'office', 'telephone', 'email', 'webPage']) });
      tabs.push(attributes('Address', [['streetAddress', 'Street'], ['city', 'City'], ['state', 'State/province'], ['postalCode', 'ZIP/postal code'], ['country', 'Country/region']]));
      tabs.push({ label: 'Account', render: () => {
        const content = h('div.aduc-form', F.row('User logon name:', text('upn'), { labelWidth: 170 }),
          F.row('User logon name (pre-Windows 2000):', h('div.aduc-inline', F.value(A.netbios() + '\\'), text('sam')), { labelWidth: 170 }),
          F.group('Account options', check('mustChange', 'User must change password at next logon'), check('cannotChange', 'User cannot change password'),
            check('neverExpires', 'Password never expires'), check('disabled', 'Account is disabled', !o.enabled)),
          check('unlock', 'Unlock account', false), F.note(o.lockedOut ? 'This account is currently locked out.' : 'This account is not locked out.'));
        controls.unlock.input.disabled = !o.lockedOut;
        controls.mustChange.input.addEventListener('change', () => { if (controls.mustChange.checked) { controls.cannotChange.checked = false; controls.neverExpires.checked = false; } });
        for (const k of ['cannotChange', 'neverExpires']) controls[k].input.addEventListener('change', () => { if (controls[k].checked) controls.mustChange.checked = false; });
        return content;
      }, apply: () => {
        // Validate enabling before changing any options on this tab.
        const current = A.get(o.id);
        if (!current) return { ok: false, error: 'The object no longer exists.' };
        if (!controls.disabled.checked && current.password == null && current.rid !== 500) return { ok: false, error: 'Set a password before enabling this account.' };
        let r = apply(['upn', 'sam', 'mustChange', 'cannotChange', 'neverExpires']); if (!r.ok) return r;
        if (controls.disabled.checked !== baseline.disabled) { r = A.setEnabled(o.id, !controls.disabled.checked); if (!r.ok) return r; baseline.disabled = controls.disabled.checked; }
        if (controls.unlock.checked) { r = A.unlock(o.id); if (!r.ok) return r; controls.unlock.checked = false; controls.unlock.input.disabled = true; }
        return { ok: true };
      } });
      tabs.push(attributes('Profile', [['profilePath', 'Profile path'], ['scriptPath', 'Logon script'], ['homeDirectory', 'Home folder'], ['homeDrive', 'Home drive']]));
      tabs.push(attributes('Telephones', [['mobile', 'Mobile']]));
      let managerId = o.manager || null, savedManager = managerId;
      const manager = D.field('manager', F.text({ value: (A.get(managerId) || {}).name || '', readOnly: true }));
      const organization = attributes('Organization', [['title', 'Title'], ['department', 'Department'], ['company', 'Company']]);
      const orgRender = organization.render, orgApply = organization.apply;
      organization.render = () => h('div', orgRender(), F.stack('Manager:', h('div.aduc-manager', manager,
        F.button('Change...', async () => {
          const picked = await WS.ui.objectPicker({ source: 'ad', types: ['user'], multi: false, filter: x => x.id !== o.id });
          if (picked && picked.length && sheet.frame.shade.isConnected) { managerId = picked[0].id; manager.value = picked[0].name; sheet.setDirty(); }
        }), F.button('Clear', () => { managerId = null; manager.value = ''; sheet.setDirty(); }))));
      organization.apply = () => { const r = orgApply(); if (!r.ok || managerId === savedManager) return r; const m = A.setProps(o.id, { manager: managerId }); if (m.ok) savedManager = managerId; return m; };
      tabs.push(organization, membership('memberOf'));
    } else if (o.type === 'group') {
      let scope, category, savedScope = o.scope, savedCategory = o.category;
      tabs.push({ label: 'General', render: () => {
        scope = D.field('scope', F.select([{ value: 'DomainLocal', label: 'Domain local' }, 'Global', 'Universal'], o.scope, { disabled: o.critical || o.builtin }));
        category = D.field('category', F.select(['Security', 'Distribution'], o.category, { disabled: o.critical || o.builtin }));
        return h('div.aduc-form', header(o), F.row('Group name (pre-Windows 2000):', text('sam'), { labelWidth: 175 }), F.row('Description:', text('description')),
          F.row('E-mail:', text('email')), F.row('Group scope:', scope), F.row('Group type:', category), F.stack('Notes:', text('notes')));
      }, apply: () => {
        if (scope.value !== savedScope || category.value !== savedCategory) {
          const r = A.setGroupScope(o.id, scope.value, category.value); if (!r.ok) return r;
          savedScope = scope.value; savedCategory = category.value;
        }
        return apply(['sam', 'description', 'email', 'notes']);
      } });
      tabs.push(membership('members'), membership('memberOf'), managedBy());
    } else if (o.type === 'computer') {
      tabs.push({ label: 'General', render: () => h('div.aduc-form', header(o), F.row('Computer name:', F.value(o.sam.replace(/\$$/, ''))),
        F.row('DNS name:', F.value(o.dnsHostName)), F.row('Description:', text('description')),
        check('disabled', 'Account is disabled', !o.enabled)), apply: () => {
          const r = apply(['description']); if (!r.ok) return r;
          if (controls.disabled.checked === baseline.disabled) return { ok: true };
          const e = A.setEnabled(o.id, !controls.disabled.checked); if (e.ok) baseline.disabled = controls.disabled.checked; return e;
        } });
      tabs.push({ label: 'Operating System', render: () => h('div.aduc-form', F.row('Name:', F.value(o.os)), F.row('Version:', F.value(o.osVersion))) },
        membership('memberOf'), attributes('Location', [['location', 'Location']]), managedBy());
    } else if (o.type === 'organizationalUnit') {
      tabs.push({ label: 'General', render: () => h('div.aduc-form', header(o), F.row('Description:', text('description')),
        ...[['street', 'Street'], ['city', 'City'], ['state', 'State/province'], ['postalCode', 'ZIP/postal code'], ['country', 'Country/region']].map(([key, label]) => F.row(label + ':', text(key)))),
        apply: () => apply(['description', 'street', 'city', 'state', 'postalCode', 'country']) }, managedBy());
    } else {
      const editable = o.type === 'container';
      tabs.push({ label: 'General', render: () => h('div.aduc-form', header(o), F.row('Description:', editable ? text('description') : F.value(o.description)),
        o.type === 'domainDNS' ? F.row('Domain:', F.value(A.domain())) : null,
        o.type === 'domainDNS' ? F.row('Domain functional level:', F.value(WS.state.ad.domainMode)) : null), apply: () => editable ? apply(['description']) : { ok: true } });
    }
    if (opts.advanced) tabs.push({ label: 'Object', render: () => h('div.aduc-form.aduc-object',
      F.row('Canonical name:', F.value(A.canonical(o))), F.row('Distinguished name:', F.value(A.dn(o))), F.row('Object class:', F.value(o.type)),
      F.row('Created:', F.value(date(o.created))), F.row('Modified:', F.value(date(o.modified))), F.row('Object GUID:', F.value(o.id)),
      o.sid ? F.row('Object SID:', F.value(o.sid)) : null,
      ['user', 'group', 'computer', 'organizationalUnit', 'container'].includes(o.type) ? check('protected', 'Protect object from accidental deletion') : null),
      apply: () => apply(['protected']) });
    return WS.ui.propertySheet({ title: o.name + ' Properties', width: 520, errorTitle: 'Active Directory Domain Services', tabs,
      onCreate: s => { sheet = s; if (opts.onCreate) opts.onCreate(s); } });
  }
  D.properties = properties;
})();

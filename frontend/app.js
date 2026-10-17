'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const ROLE_NAMES = ['None', 'Member', 'Treasurer', 'Adviser', 'Admin'];
  const STATUS_NAMES = ['Pending', 'Partially approved', 'Approved', 'Rejected', 'Released', 'Cancelled'];
  const PAGE_COPY = {
    dashboard: ['Dashboard', 'On-chain overview of your local FundFlow deployment.'],
    requests: ['Fund requests', 'Create, approve, reject or release requests using local test accounts.'],
    members: ['Members', 'Member records and role permissions on the active local contract.'],
    transactions: ['Transaction log', 'Decoded contract events from the current local chain.'],
    setup: ['Local setup', 'Connection details, deployment information and test instructions.']
  };
  let statusInfo = null;
  let state = null;
  let selectedAccount = '';
  let demoBusy = false;
  let toastTimer = null;
  let notificationItems = readNotifications();
  let modalResolver = null;
  let modalOptions = null;
  const aiHistory = [];
  let aiAvailable = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  const shortAddress = (address) => address ? `${address.slice(0, 7)}…${address.slice(-5)}` : '—';
  const roleName = (role) => ROLE_NAMES[Number(role)] || 'Unknown';
  const statusName = (status) => STATUS_NAMES[Number(status)] || 'Unknown';
  const statusClass = (status) => ['pending', 'partially-approved', 'approved', 'rejected', 'released', 'cancelled'][Number(status)] || 'pending';
  const fmtEth = (wei) => {
    try {
      const value = BigInt(wei || '0');
      const unit = 10n ** 18n;
      const whole = value / unit;
      const fraction = (value % unit).toString().padStart(18, '0').slice(0, 5).replace(/0+$/, '');
      return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} tETH`;
    } catch { return '0 tETH'; }
  };
  const fmtDate = (seconds) => {
    const value = Number(seconds || 0);
    if (!value) return '—';
    return new Date(value * 1000).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  const initials = (name) => String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  const isAdmin = () => !!state && String(state.account).toLowerCase() === String(state.admin).toLowerCase();
  const currentRole = () => state?.currentMember?.active ? Number(state.currentMember.role) : 0;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function toast(message, kind = 'info') {
    const el = $('toast');
    el.textContent = message;
    el.className = `toast show${kind === 'error' ? ' error' : kind === 'success' ? ' success' : ''}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { el.classList.remove('show'); }, 4400);
    if (kind === 'success' || kind === 'error') {
      addNotification(kind === 'success' ? 'Action completed' : 'Action needs attention', message, kind);
    }
  }

  function readNotifications() {
    try {
      const saved = JSON.parse(localStorage.getItem('fundflow_notifications_v1') || '[]');
      return Array.isArray(saved) ? saved.filter((n) => n && typeof n.message === 'string').slice(0, 30) : [];
    } catch { return []; }
  }

  function persistNotifications() {
    try { localStorage.setItem('fundflow_notifications_v1', JSON.stringify(notificationItems.slice(0, 30))); } catch { /* storage may be disabled */ }
  }

  function addNotification(title, message, kind = 'info') {
    notificationItems.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title: String(title).slice(0, 90), message: String(message).slice(0, 280), kind,
      createdAt: new Date().toISOString(), read: false
    });
    notificationItems = notificationItems.slice(0, 30);
    persistNotifications();
    renderNotifications();
  }

  function renderNotifications() {
    const list = $('notificationList');
    if (!list) return;
    const unread = notificationItems.filter((n) => !n.read).length;
    const badge = $('notificationBadge');
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.hidden = unread === 0;
    $('notificationSummary').textContent = unread ? `${unread} unread update${unread === 1 ? '' : 's'} · this browser` : 'All caught up · this browser';
    if (!notificationItems.length) {
      list.innerHTML = '<div class="notification-empty"><strong>You are all caught up.</strong><span>Transaction confirmations and errors will appear here.</span></div>';
      return;
    }
    list.innerHTML = notificationItems.map((n) => `<article class="notification-item ${n.read ? 'read' : 'unread'} ${n.kind === 'error' ? 'is-error' : n.kind === 'success' ? 'is-success' : ''}" data-notification-id="${esc(n.id)}"><span class="notification-kind" aria-hidden="true">${n.kind === 'error' ? '!' : n.kind === 'success' ? '✓' : 'i'}</span><div class="notification-copy"><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><time>${esc(new Date(n.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</time></div>${n.read ? '' : '<span class="notification-unread-dot" aria-label="Unread"></span>'}</article>`).join('');
    list.querySelectorAll('[data-notification-id]').forEach((el) => el.addEventListener('click', () => {
      const item = notificationItems.find((n) => n.id === el.dataset.notificationId);
      if (item) { item.read = true; persistNotifications(); renderNotifications(); }
    }));
  }

  function showActionModal(options) {
    modalOptions = options;
    $('actionModalTitle').textContent = options.title || 'Confirm action';
    $('actionModalDescription').textContent = options.description || 'Review the details first.';
    $('actionModalMark').textContent = options.mark || (options.danger ? '!' : '✓');
    $('actionModalMark').className = `modal-mark${options.danger ? ' danger' : ''}`;
    $('actionModalConfirm').textContent = options.confirmLabel || 'Confirm';
    $('actionModalConfirm').className = `button ${options.danger ? 'danger' : 'primary'}`;
    $('actionModalBody').innerHTML = options.body || '';
    $('actionModalError').hidden = true;
    $('actionModalError').textContent = '';
    $('actionModal').hidden = false;
    document.body.classList.add('modal-open');
    window.setTimeout(() => $('actionModalBody').querySelector('textarea,input,button')?.focus(), 20);
    return new Promise((resolve) => { modalResolver = resolve; });
  }

  function closeActionModal(result = null) {
    $('actionModal').hidden = true;
    document.body.classList.remove('modal-open');
    const resolver = modalResolver;
    modalResolver = null;
    modalOptions = null;
    if (resolver) resolver(result);
  }

  function confirmDialog(options) { return showActionModal(options).then((value) => value === true); }

  function closeNotificationPanel() {
    $('notificationPanel').hidden = true;
    $('notificationButton').setAttribute('aria-expanded', 'false');
  }

  function roleAwareMetric(id, label, value, foot) {
    $(`metricLabel${id}`).textContent = label;
    $(`${id === 'Balance' ? 'balanceValue' : id === 'Members' ? 'memberValue' : id === 'Requests' ? 'requestValue' : 'roleValue'}`).textContent = value;
    $(`metricFoot${id}`).textContent = foot;
  }

  function setBusy(button, busy, busyLabel = 'Working…') {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyLabel;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      delete button.dataset.originalText;
    }
  }

  function setNetworkUI(connected, detail = '') {
    $('networkDot').style.background = connected ? 'var(--green)' : 'var(--orange)';
    $('networkStatus').textContent = connected ? 'Hardhat local node ready' : 'Local node unavailable';
    $('networkDetail').textContent = detail || (connected ? 'Chain ID 31337 · test accounts only' : 'Start `npm run node` in terminal 1.');
    $('setupStateTag').textContent = connected ? (state?.contractAddress ? 'Contract loaded' : 'Node connected') : 'Disconnected';
  }

  function go(page) {
    if (!PAGE_COPY[page]) return;
    document.querySelectorAll('.page-view').forEach((view) => view.classList.toggle('active', view.id === `page-${page}`));
    document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
    $('pageTitle').textContent = PAGE_COPY[page][0];
    $('pageSubtitle').textContent = PAGE_COPY[page][1];
    window.location.hash = page;
  }

  function populateAccounts(accounts) {
    const select = $('accountSelect');
    if (!accounts?.length) {
      select.innerHTML = '<option value="">No local accounts</option>';
      select.disabled = true;
      $('recipient').innerHTML = '<option value="">Connect local node first</option>';
      $('memberWallet').innerHTML = '<option value="">Connect local node first</option>';
      return;
    }
    select.disabled = false;
    select.innerHTML = accounts.map((address, index) => {
      const member = state?.members?.find((m) => m.wallet.toLowerCase() === address.toLowerCase());
      const label = member ? `${member.name} · ${roleName(member.role)}` : `Unlocked test account #${index}`;
      return `<option value="${esc(address)}">#${index} · ${esc(label)} · ${esc(shortAddress(address))}</option>`;
    }).join('');
    if (!selectedAccount || !accounts.some((a) => a.toLowerCase() === selectedAccount.toLowerCase())) selectedAccount = accounts[0];
    select.value = selectedAccount;
    const recipientOptions = accounts.map((address, index) => {
      const member = state?.members?.find((m) => m.wallet.toLowerCase() === address.toLowerCase());
      const label = member ? `${member.name} (${roleName(member.role)})` : `Test account #${index}`;
      return `<option value="${esc(address)}">${esc(label)} — ${esc(shortAddress(address))}</option>`;
    }).join('');
    $('recipient').innerHTML = `<option value="">Select a recipient</option>${recipientOptions}`;
    const registered = new Set((state?.members || []).map((m) => m.wallet.toLowerCase()));
    $('memberWallet').innerHTML = `<option value="">Select an unregistered test account</option>` + accounts
      .filter((a) => !registered.has(a.toLowerCase()))
      .map((address, index) => `<option value="${esc(address)}">${esc(shortAddress(address))} · local test account</option>`).join('');
    if ($('memberWallet').options.length === 1) $('memberWallet').innerHTML = '<option value="">All node accounts are already registered</option>';
  }

  async function checkNode() {
    try {
      statusInfo = await api('/api/status');
      setNetworkUI(true, `Chain ID ${statusInfo.chainId} · ${statusInfo.accounts.length} unlocked test accounts`);
      if (!state) populateAccounts(statusInfo.accounts);
      if (statusInfo.contractLoaded && !state) await refreshState();
    } catch (error) {
      statusInfo = null;
      state = null;
      setNetworkUI(false, error.message);
      $('balanceValue').textContent = '—'; $('memberValue').textContent = '—'; $('requestValue').textContent = '—'; $('roleValue').textContent = '—';
      $('recentRequests').textContent = 'Waiting for a deployed local contract.';
      $('recentActivity').textContent = 'No event history loaded.';
      populateAccounts([]);
    }
  }

  async function refreshState() {
    try {
      statusInfo = await api('/api/status');
      if (!statusInfo.contractLoaded) {
        state = null;
        setNetworkUI(true, `Chain ID ${statusInfo.chainId} · contract not deployed yet`);
        populateAccounts(statusInfo.accounts);
        $('balanceValue').textContent = '—'; $('memberValue').textContent = '—'; $('requestValue').textContent = '—'; $('roleValue').textContent = '—';
        $('recentRequests').innerHTML = '<div class="empty-state">No active contract. Click <strong>Run Full Demo</strong> to deploy a fresh contract and seed real local test records.</div>';
        $('recentActivity').innerHTML = '<div class="empty-state">No contract events to display yet.</div>';
        $('requestsTable').innerHTML = '<div class="empty-state">Deploy a contract to display requests.</div>';
        $('membersTable').innerHTML = '<div class="empty-state">Deploy a contract to display members.</div>';
        $('activityTable').innerHTML = '<div class="empty-state">No contract events.</div>';
        $('contractAddress').textContent = 'Not deployed'; $('adminAddress').textContent = '—'; $('setupAccount').textContent = selectedAccount || '—';
        return;
      }
      if (!selectedAccount || !statusInfo.accounts.some((a) => a.toLowerCase() === selectedAccount.toLowerCase())) selectedAccount = statusInfo.accounts[0];
      state = await api(`/api/state?account=${encodeURIComponent(selectedAccount)}`);
      setNetworkUI(true, `Chain ID ${state.chainId} · Contract ${shortAddress(state.contractAddress)}`);
      populateAccounts(state.accounts);
      renderAll();
    } catch (error) {
      toast(error.message, 'error');
      setNetworkUI(false, error.message);
    }
  }

  function renderAll() {
    if (!state) return;
    const balance = fmtEth(state.balanceWei);
    $('balanceValue').textContent = balance;
    $('memberValue').textContent = String(state.memberCount);
    $('requestValue').textContent = String(state.requestCount);
    $('roleValue').textContent = state.currentMember?.active ? roleName(state.currentMember.role) : (isAdmin() ? 'Admin' : 'Unregistered');
    $('accountRoleFoot').textContent = `${state.currentMember?.name || 'Unregistered local account'} · ${shortAddress(state.account)}`;
    $('pendingCount').textContent = String(state.requests.filter((r) => r.status === 0 || r.status === 1).length);
    $('contractAddress').textContent = state.contractAddress;
    $('adminAddress').textContent = state.admin;
    $('setupAccount').textContent = state.account;
    $('selectedMemberAddress').textContent = shortAddress(state.account);
    $('directoryCount').textContent = `${state.members.length} registered accounts`;
    $('activeMemberCount').textContent = String(state.members.filter((m) => m.active).length);
    $('inactiveMemberCount').textContent = String(state.members.filter((m) => !m.active).length);
    const owner = isAdmin();
    $('memberForm').querySelectorAll('input,select,button').forEach((el) => { el.disabled = !owner; });
    $('memberWallet').disabled = !owner || $('memberWallet').options.length <= 1;
    $('requestForm').querySelectorAll('input,select,button').forEach((el) => { el.disabled = currentRole() !== 1; });
    $('requestForm').querySelector('button[type="submit"]').disabled = currentRole() !== 1;
    $('setupStateTag').textContent = 'Contract loaded';
    renderRequests(); renderMembers(); renderActivity(); renderDashboard();
  }

  function statusTag(status) {
    return `<span class="tag ${statusClass(status)}">${esc(statusName(status))}</span>`;
  }

  function actionsForRequest(r) {
    const role = currentRole();
    const account = String(state.account).toLowerCase();
    const isRequester = String(r.requester).toLowerCase() === account;
    const buttons = [];
    if (role === 2) {
      if (r.status === 0) buttons.push(`<button class="button small" data-action="approve-treasurer" data-id="${r.id}">Approve</button>`);
      if (r.status === 0 || r.status === 1) buttons.push(`<button class="button small danger" data-action="reject" data-id="${r.id}">Reject</button>`);
      if (r.status === 2) buttons.push(`<button class="button small" data-action="release" data-id="${r.id}">Release</button>`);
    }
    if (role === 3) {
      if (r.status === 1 && r.requiresAdviser) buttons.push(`<button class="button small" data-action="approve-adviser" data-id="${r.id}">Approve</button>`);
      if (r.status === 0 || r.status === 1) buttons.push(`<button class="button small danger" data-action="reject" data-id="${r.id}">Reject</button>`);
    }
    if (role === 1 && isRequester && r.status === 0) buttons.push(`<button class="button small secondary" data-action="cancel" data-id="${r.id}">Cancel</button>`);
    return buttons.length ? `<div class="table-actions">${buttons.join('')}</div>` : '<span class="muted">—</span>';
  }

  function renderRequests() {
    if (!state) return;
    const query = ($('requestSearch').value || '').trim().toLowerCase();
    const filter = $('requestFilter').value;
    const rows = state.requests.filter((r) => {
      const matchesFilter = filter === 'all' || Number(r.status) === Number(filter);
      const text = [r.id, r.purpose, r.category, r.requester, r.recipient, statusName(r.status), r.rejectionReason].join(' ').toLowerCase();
      return matchesFilter && text.includes(query);
    });
    if (!rows.length) {
      $('requestsTable').innerHTML = '<div class="empty-state">No requests match this filter. Create a request or run the full demo.</div>';
      return;
    }
    $('requestsTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Reference / Purpose</th><th>Amount</th><th>Requester / Recipient</th><th>Approval</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map((r) => {
      const member = state.members.find((m) => m.wallet.toLowerCase() === r.requester.toLowerCase());
      const approval = `Treasurer ${r.treasurerApproved ? '✓' : '—'}<br>Adviser ${r.requiresAdviser ? (r.adviserApproved ? '✓' : '—') : 'N/A'}`;
      return `<tr><td><strong>#${r.id} · ${esc(r.purpose)}</strong><div class="person-meta">${esc(r.category)}${r.rejectionReason ? `<br>Reason: ${esc(r.rejectionReason)}` : ''}</div></td><td><strong>${esc(fmtEth(r.amountWei))}</strong></td><td class="mono">${esc(member?.name || shortAddress(r.requester))}<div class="person-meta">To ${esc(shortAddress(r.recipient))}</div></td><td>${approval}</td><td>${statusTag(r.status)}<div class="person-meta">${esc(fmtDate(r.status === 4 ? r.releasedAt : r.createdAt))}</div></td><td>${actionsForRequest(r)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function renderMembers() {
    if (!state) return;
    const query = ($('memberSearch').value || '').trim().toLowerCase();
    const filter = $('memberFilter').value;
    const rows = state.members.filter((m) => {
      const statusMatches = filter === 'all' || (filter === 'active' ? m.active : !m.active);
      return statusMatches && [m.name, m.wallet, roleName(m.role)].join(' ').toLowerCase().includes(query);
    });
    if (!rows.length) { $('membersTable').innerHTML = '<div class="empty-state">No members match this search.</div>'; return; }
    $('membersTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Member</th><th>Wallet address</th><th>Role</th><th>Registered</th><th>Status</th><th>Admin action</th></tr></thead><tbody>${rows.map((m) => {
      const canToggle = isAdmin() && m.wallet.toLowerCase() !== state.admin.toLowerCase();
      return `<tr><td><div class="person-cell"><span class="avatar">${esc(initials(m.name))}</span><span><strong class="person-name">${esc(m.name)}</strong><span class="person-meta">${m.wallet.toLowerCase() === state.admin.toLowerCase() ? 'Contract owner' : 'Registered member'}</span></span></div></td><td class="mono" title="${esc(m.wallet)}">${esc(shortAddress(m.wallet))}</td><td>${esc(roleName(m.role))}</td><td>${esc(fmtDate(m.registeredAt))}</td><td><span class="tag ${m.active ? 'released' : 'rejected'}">${m.active ? 'Active' : 'Inactive'}</span></td><td>${canToggle ? `<button class="button small ${m.active ? 'danger' : 'secondary'}" data-action="toggle-member" data-wallet="${esc(m.wallet)}" data-active="${!m.active}">${m.active ? 'Deactivate' : 'Activate'}</button>` : '<span class="muted">—</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function renderActivity() {
    if (!state) return;
    const query = ($('activitySearch').value || '').trim().toLowerCase();
    const rows = state.activity.filter((a) => [a.event, a.actor, a.ref, a.details, a.txHash].join(' ').toLowerCase().includes(query));
    const shortRows = rows.slice(0, 100);
    if (!shortRows.length) { $('activityTable').innerHTML = '<div class="empty-state">No events match this search.</div>'; return; }
    $('activityTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Event</th><th>Reference / Details</th><th>Actor</th><th>Block</th><th>Transaction hash</th></tr></thead><tbody>${shortRows.map((a) => {
      const actorMember = state.members.find((m) => m.wallet.toLowerCase() === String(a.actor).toLowerCase());
      return `<tr><td><strong>${esc(a.event)}</strong></td><td>${esc(a.ref)}<div class="person-meta">${esc(a.details)}</div></td><td>${esc(actorMember?.name || (a.actor ? shortAddress(a.actor) : 'Contract'))}</td><td>${Number(a.blockNumber)}</td><td class="mono" title="${esc(a.txHash)}">${esc(a.txHash ? `${a.txHash.slice(0, 12)}…${a.txHash.slice(-6)}` : '—')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function renderActivityCards(target, list) {
    if (!list.length) { $(target).innerHTML = '<div class="empty-state">No contract events yet.</div>'; return; }
    $(target).innerHTML = `<div class="request-card-list">${list.slice(0, 4).map((a) => {
      const actor = state.members.find((m) => m.wallet.toLowerCase() === String(a.actor).toLowerCase());
      return `<article class="request-card"><div><h3>${esc(a.event)}</h3><p>${esc(actor?.name || (a.actor ? shortAddress(a.actor) : 'Contract'))} · ${esc(a.ref)}</p><span class="person-meta">${esc(a.details)}</span></div><div class="request-amount">#${Number(a.blockNumber)}</div></article>`;
    }).join('')}</div>`;
  }

  function renderDashboard() {
    if (!state) return;
    const account = String(state.account).toLowerCase();
    const myRequests = state.requests.filter((r) => String(r.requester).toLowerCase() === account);
    const pendingMine = myRequests.filter((r) => r.status === 0 || r.status === 1);
    const incomingReleased = state.requests.filter((r) => r.status === 4 && String(r.recipient).toLowerCase() === account);
    const receivedWei = incomingReleased.reduce((sum, r) => sum + BigInt(r.amountWei || '0'), 0n);
    const toTreasurer = state.requests.filter((r) => r.status === 0);
    const approvedForRelease = state.requests.filter((r) => r.status === 2);
    const toAdviser = state.requests.filter((r) => r.status === 1 && r.requiresAdviser && !r.adviserApproved);
    const largeRequests = state.requests.filter((r) => r.requiresAdviser);
    const viewerRole = isAdmin() ? 4 : currentRole();
    let open = [];

    if (viewerRole === 4) {
      roleAwareMetric('Balance', 'CONTRACT POOL BALANCE', fmtEth(state.balanceWei), 'Shared test ETH held by the contract');
      roleAwareMetric('Members', 'REGISTERED MEMBERS', String(state.memberCount), 'All registered on-chain accounts');
      roleAwareMetric('Requests', 'ALL FUND REQUESTS', String(state.requestCount), 'Every request on the contract');
      open = state.requests.filter((r) => r.status === 0 || r.status === 1).slice(0, 4);
    } else if (viewerRole === 2) {
      roleAwareMetric('Balance', 'SHARED POOL AVAILABLE', fmtEth(state.balanceWei), 'Pool shared by the FundFlow contract');
      roleAwareMetric('Members', 'AWAITING TREASURER', String(toTreasurer.length), 'Pending requests for Treasurer action');
      roleAwareMetric('Requests', 'APPROVED TO RELEASE', String(approvedForRelease.length), 'Approved requests awaiting fund release');
      open = state.requests.filter((r) => r.status === 0 || r.status === 2).slice(0, 4);
    } else if (viewerRole === 3) {
      const awaitingWei = toAdviser.reduce((sum, r) => sum + BigInt(r.amountWei || '0'), 0n);
      roleAwareMetric('Balance', 'FUNDS AWAITING REVIEW', fmtEth(awaitingWei), 'Total of large requests awaiting Adviser approval');
      roleAwareMetric('Members', 'AWAITING YOUR REVIEW', String(toAdviser.length), 'Treasurer-approved requests needing you');
      roleAwareMetric('Requests', 'LARGE REQUESTS', String(largeRequests.length), 'Requests over the Adviser approval threshold');
      open = state.requests.filter((r) => (r.status === 1 && r.requiresAdviser) || r.status === 0).slice(0, 4);
    } else if (viewerRole === 1) {
      const myRequestedWei = myRequests.reduce((sum, r) => sum + BigInt(r.amountWei || '0'), 0n);
      roleAwareMetric('Balance', 'MY REQUESTED TOTAL', fmtEth(myRequestedWei), 'Total amount across your submitted requests');
      roleAwareMetric('Members', 'MY OPEN REQUESTS', String(pendingMine.length), 'Your requests awaiting a decision');
      roleAwareMetric('Requests', 'FUNDS RELEASED TO YOU', fmtEth(receivedWei), 'Released requests where you are the recipient');
      open = [...myRequests].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 4);
    } else {
      roleAwareMetric('Balance', 'ROLE REQUIRED', '—', 'Register this local account to use FundFlow actions');
      roleAwareMetric('Members', 'REGISTERED MEMBERS', String(state.memberCount), 'Records currently on this contract');
      roleAwareMetric('Requests', 'FUND REQUESTS', String(state.requestCount), 'Requests currently on this contract');
      open = [];
    }
    $('roleValue').textContent = viewerRole === 4 ? 'Admin' : (viewerRole ? roleName(viewerRole) : 'Unregistered');
    $('accountRoleFoot').textContent = `${state.currentMember?.name || (viewerRole === 4 ? 'Contract owner' : 'Unregistered local account')} · ${shortAddress(state.account)}`;
    $('page-dashboard')?.setAttribute('data-viewer-role', roleName(viewerRole).toLowerCase());
    if (!open.length) {
      const emptyCopy = viewerRole === 1 ? 'You do not have any submitted requests yet.' : viewerRole === 3 ? 'No requests currently need Adviser review.' : viewerRole === 2 ? 'No pending Treasurer actions or approved releases.' : 'No open requests are waiting for attention.';
      $('recentRequests').innerHTML = `<div class="empty-state">${esc(emptyCopy)}</div>`;
    } else {
      $('recentRequests').innerHTML = `<div class="request-card-list">${open.map((r) => {
        const member = state.members.find((m) => m.wallet.toLowerCase() === String(r.requester).toLowerCase());
        const who = viewerRole === 1 ? 'Your request' : (member?.name || shortAddress(r.requester));
        return `<article class="request-card"><div><h3>#${r.id} · ${esc(r.purpose)}</h3><p>${esc(r.category)} · ${esc(who)}</p>${statusTag(r.status)}</div><div class="request-amount">${esc(fmtEth(r.amountWei))}</div></article>`;
      }).join('')}</div>`;
    }
    renderActivityCards('recentActivity', state.activity);
  }

  async function connectSavedDeployment() {
    const button = $('connectBtn');
    setBusy(button, true, 'Connecting…');
    try {
      await api('/api/connect', { method: 'POST' });
      await refreshState();
      toast('Loaded the saved deployment from the local Hardhat chain.', 'success');
    } catch (error) {
      await checkNode();
      toast(error.message, 'error');
    } finally { setBusy(button, false); }
  }

  async function runFullDemo() {
    if (demoBusy) return;
    demoBusy = true;
    const button = $('runDemoBtn');
    setBusy(button, true, 'Running local transactions…');
    $('demoResults').innerHTML = '<div class="empty-state">Deploying contract and submitting real local test transactions. Keep this tab open…</div>';
    try {
      const response = await fetch('/api/demo/run', { method: 'POST' });
      const data = await response.json();
      renderDemoReport(data);
      if (!response.ok || !data.ok) throw new Error(data.error || 'The demo encountered a failed step. Review the report below.');
      selectedAccount = statusInfo?.accounts?.[0] || selectedAccount;
      await refreshState();
      go('setup');
      toast(`Demo complete: ${data.passCount} checks passed. Contract ${shortAddress(data.contractAddress)}.`, 'success');
    } catch (error) {
      toast(error.message, 'error');
      await refreshState().catch(() => {});
    } finally {
      button.disabled = false;
      button.textContent = '▶ Run Full Demo';
      delete button.dataset.originalText;
      demoBusy = false;
    }
  }

  function renderDemoReport(data) {
    const steps = Array.isArray(data.steps) ? data.steps : [];
    if (!steps.length) {
      $('demoResults').innerHTML = `<div class="empty-state">${esc(data.error || 'No result returned.')}</div>`;
      return;
    }
    $('demoResults').innerHTML = `<div class="demo-report"><div class="demo-report-summary"><span class="tag ${data.ok ? 'released' : 'rejected'}">${data.ok ? 'DEMO PASSED' : 'DEMO FAILED'}</span><span class="tag local-tag">${Number(data.passCount || 0)} passed</span><span class="tag ${data.failCount ? 'rejected' : 'released'}">${Number(data.failCount || 0)} failed</span></div>${data.contractAddress ? `<p class="help-text">Contract: <span class="mono">${esc(data.contractAddress)}</span> · chain ID ${esc(data.chainId ?? 31337)}</p>` : ''}${steps.map((step, index) => `<div class="demo-step"><div class="demo-step-status ${step.status === 'PASS' ? 'pass' : 'fail'}">${step.status === 'PASS' ? 'PASS' : 'FAIL'} ${index + 1}</div><div><strong>${esc(step.label)}</strong><small>${esc(step.detail)}</small></div></div>`).join('')}${data.error ? `<div class="note-card"><strong>Stopped at failed step</strong><p>${esc(data.error)}</p></div>` : ''}</div>`;
  }

  async function runTransaction(action, body, label) {
    if (!state) { toast('Deploy a local contract first by running the full demo.', 'error'); return; }
    const account = selectedAccount || state.account;
    try {
      const result = await api(`/api/tx/${action}`, { method: 'POST', body: JSON.stringify({ account, ...body }) });
      toast(`${label} confirmed · block ${result.blockNumber}`, 'success');
      await refreshState();
      return true;
    } catch (error) { toast(`${label} failed: ${error.message}`, 'error'); return false; }
  }

  async function onRequestSubmit(event) {
    event.preventDefault();
    const form = $('requestForm');
    if (!form.reportValidity()) return;
    const ok = await runTransaction('create-request', {
      recipient: $('recipient').value,
      amountEth: $('amount').value,
      purpose: $('purpose').value.trim(),
      category: $('category').value
    }, 'Request creation');
    if (ok) form.reset();
  }

  async function onMemberSubmit(event) {
    event.preventDefault();
    const form = $('memberForm');
    if (!form.reportValidity()) return;
    const ok = await runTransaction('add-member', {
      name: $('memberName').value.trim(),
      wallet: $('memberWallet').value,
      role: Number($('memberRole').value)
    }, 'Member registration');
    if (ok) form.reset();
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    const id = Number(button.dataset.id);
    if (action === 'toggle-member') {
      const wallet = button.dataset.wallet;
      const active = button.dataset.active === 'true';
      const member = state?.members.find((m) => m.wallet.toLowerCase() === String(wallet).toLowerCase());
      const ok = await confirmDialog({
        title: active ? 'Reactivate member' : 'Deactivate member',
        description: active ? 'This account will be able to use its registered role again.' : 'This account will no longer be able to submit role-restricted actions.',
        confirmLabel: active ? 'Reactivate account' : 'Deactivate account', danger: !active,
        body: `<div class="modal-summary"><div class="modal-summary-row"><span>Member</span><strong>${esc(member?.name || 'Unknown member')}</strong></div><div class="modal-summary-row"><span>Role</span><strong>${esc(roleName(member?.role))}</strong></div><div class="modal-summary-row"><span>Wallet</span><code>${esc(wallet)}</code></div><div class="modal-summary-row"><span>New status</span><strong>${active ? 'Active' : 'Inactive'}</strong></div></div>`
      });
      if (!ok) return;
      return runTransaction('toggle-member', { wallet, active }, active ? 'Member activation' : 'Member deactivation');
    }
    if (!Number.isInteger(id) || id < 1) return;
    const request = state?.requests.find((r) => Number(r.id) === id);
    if (!request) { toast(`Request #${id} was not found in the latest contract data. Refresh and try again.`, 'error'); return; }
    if (action === 'reject') {
      const member = state.members.find((m) => m.wallet.toLowerCase() === String(request.requester).toLowerCase());
      const reason = await showActionModal({
        title: `Reject request #${id}`,
        description: 'The rejection reason will be recorded on the local smart contract and visible with the request.',
        confirmLabel: 'Reject request', danger: true, requireInput: true,
        body: `<div class="modal-summary"><div class="modal-summary-row"><span>Purpose</span><strong>${esc(request.purpose)}</strong></div><div class="modal-summary-row"><span>Amount</span><strong>${esc(fmtEth(request.amountWei))}</strong></div><div class="modal-summary-row"><span>Requested by</span><strong>${esc(member?.name || shortAddress(request.requester))}</strong></div></div><label class="modal-input-label" for="modalInput">Reason for rejection</label><textarea id="modalInput" rows="3" maxlength="400" placeholder="Explain why this request is being rejected…" required></textarea>`
      });
      if (typeof reason !== 'string') return;
      return runTransaction('reject', { id, reason: reason.trim() }, 'Request rejection');
    }
    if (action === 'cancel') {
      const ok = await confirmDialog({
        title: `Cancel request #${id}?`, description: 'Only the requester can cancel a pending request. This change cannot be undone.', confirmLabel: 'Cancel request', danger: true,
        body: `<div class="modal-summary"><div class="modal-summary-row"><span>Purpose</span><strong>${esc(request.purpose)}</strong></div><div class="modal-summary-row"><span>Requested amount</span><strong>${esc(fmtEth(request.amountWei))}</strong></div><div class="modal-summary-row"><span>Status</span><strong>${esc(statusName(request.status))}</strong></div></div>`
      });
      if (!ok) return;
    }
    if (action === 'release') {
      const pool = BigInt(state.balanceWei || '0');
      const amount = BigInt(request.amountWei || '0');
      const requester = state.members.find((m) => m.wallet.toLowerCase() === String(request.requester).toLowerCase());
      const recipient = state.members.find((m) => m.wallet.toLowerCase() === String(request.recipient).toLowerCase());
      const enough = pool >= amount;
      const ok = await confirmDialog({
        title: `Release funds · Request #${id}`,
        description: 'Review the amount and destination before confirming this local-chain transfer.',
        confirmLabel: 'Confirm fund release', danger: true,
        body: `<div class="release-amount-block"><span>Amount to transfer</span><strong>${esc(fmtEth(request.amountWei))}</strong><small>Local test ETH · no real monetary value</small></div><div class="modal-summary"><div class="modal-summary-row"><span>Purpose</span><strong>${esc(request.purpose)}</strong></div><div class="modal-summary-row"><span>Requester</span><strong>${esc(requester?.name || shortAddress(request.requester))}</strong></div><div class="modal-summary-row"><span>Recipient</span><div><strong>${esc(recipient?.name || 'External test account')}</strong><code>${esc(request.recipient)}</code></div></div><div class="modal-summary-row"><span>Pool before transfer</span><strong>${esc(fmtEth(state.balanceWei))}</strong></div><div class="modal-summary-row"><span>Pool after transfer</span><strong>${esc(fmtEth(pool >= amount ? String(pool - amount) : '0'))}</strong></div></div>${enough ? '' : '<div class="modal-warning">The contract pool does not have enough test ETH. Fund the pool first.</div>'}`
      });
      if (!ok) return;
      if (!enough) { toast('The shared contract pool has insufficient test ETH. Fund it first.', 'error'); return; }
    }
    const labels = { 'approve-treasurer': 'Treasurer approval', 'approve-adviser': 'Adviser approval', cancel: 'Request cancellation', release: 'Fund release' };
    return runTransaction(action, { id }, labels[action] || 'Transaction');
  }

  function exportCsv() {
    if (!state?.activity?.length) { toast('No local-chain events to export.', 'error'); return; }
    const rows = [['Event', 'Reference', 'Actor', 'Details', 'Block', 'Transaction Hash'], ...state.activity.map((a) => [a.event, a.ref, a.actor, a.details, a.blockNumber, a.txHash])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = 'fundflow-local-activity.csv'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported the current local event history as CSV.', 'success');
  }

  function renderMarkdown(src) {
    const inline = (text) => esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    const out = [];
    let list = null, para = [], table = [], inCode = false, code = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table
        .filter((r) => !/^[\s|:-]+$/.test(r))
        .map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      if (rows.length) {
        const [head, ...body] = rows;
        out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      }
      table = [];
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (line.trim().startsWith('```')) {
        if (inCode) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = []; inCode = false; }
        else { flushPara(); closeList(); flushTable(); inCode = true; }
        continue;
      }
      if (inCode) { code.push(raw); continue; }
      if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); closeList(); table.push(line); continue; }
      flushTable();
      if (!line.trim()) { flushPara(); closeList(); continue; }
      let m;
      if ((m = line.match(/^#{1,6}\s+(.*)$/))) { flushPara(); closeList(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        flushPara();
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push(`<li>${inline(m[1])}</li>`); continue;
      }
      if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
        flushPara();
        if (list !== 'ol') { closeList(); out.push(`<ol start="${Number(m[1])}">`); list = 'ol'; }
        out.push(`<li>${inline(m[2])}</li>`); continue;
      }
      closeList();
      para.push(inline(line.trim()));
    }
    if (inCode) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    flushTable(); flushPara(); closeList();
    return out.join('');
  }

  function appendAiMessage(role, message, pending = false) {
    const box = $('aiMessages');
    const isUser = role === 'user';
    const article = document.createElement('article');
    article.className = `chat-bubble ${isUser ? 'user-message' : 'assistant-message'}${pending ? ' ai-pending' : ''}`;
    if (pending) {
      article.innerHTML = '<span class="typing-indicator"><i></i><i></i><i></i></span><span>Thinking…</span>';
    } else if (isUser) {
      article.textContent = message;
    } else {
      article.innerHTML = `<span class="chat-author">FundFlow AI</span><div class="md">${renderMarkdown(message)}</div>`;
    }
    box.appendChild(article);
    // Sagot ni AI: ituro sa simula para nababasa mula taas. Iba: bumaba sa dulo.
    if (!isUser && !pending) box.scrollTop = Math.max(0, article.offsetTop - 14);
    else box.scrollTop = box.scrollHeight;
    return article;
  }

  function setAiStatusMessage(message, kind = 'info') {
    const el = $('aiStatusMessage');
    if (!el) return;
    el.textContent = message;
    el.className = `ai-status-message ${kind}`;
  }

  async function checkAiStatus() {
    const statusPill = $('aiStatusPill');
    const input = $('aiMessageInput');
    const send = $('aiSendButton');
    if (statusPill) statusPill.textContent = 'Checking';
    setAiStatusMessage('Checking the local AI endpoint…', 'info');
    try {
      const result = await api('/api/ai/status', { cache: 'no-store' });
      aiAvailable = Boolean(result.configured);
      statusPill.textContent = aiAvailable ? 'Groq ready' : 'Setup needed';
      statusPill.classList.toggle('ready', aiAvailable);
      $('aiPanelSubtitle').textContent = aiAvailable ? `Groq · ${result.model}` : 'Chat is open, but AI is not configured';
      input.disabled = !aiAvailable;
      send.disabled = !aiAvailable;
      if (!aiAvailable) {
        input.placeholder = 'Configure the server-side .env first…';
        setAiStatusMessage('The chat window works, but the server did not find GROQ_API_KEY. Put the real key in C:\\FundFlow\\.env (not .env.example), save, then restart npm run app.', 'warning');
      } else if (result.modelUpdated) {
        input.placeholder = 'Ask about FundFlow…';
        setAiStatusMessage(`Groq is configured. The old model setting “${result.requestedModel}” is retired, so this app is using ${result.model}. Update GROQ_MODEL in C:\\FundFlow\\.env to keep it explicit.`, 'warning');
      } else {
        input.placeholder = 'Ask about FundFlow…';
        setAiStatusMessage(`AI service is configured and ready · ${result.model}. Your messages go to Groq through the local backend.`, 'ready');
      }
    } catch (error) {
      aiAvailable = false;
      statusPill.textContent = 'Offline';
      statusPill.classList.remove('ready');
      $('aiPanelSubtitle').textContent = 'Local AI endpoint unreachable';
      input.disabled = true;
      send.disabled = true;
      input.placeholder = 'Restart the local app to reconnect…';
      setAiStatusMessage(`Cannot reach /api/ai/status. Stop and restart npm run app from C:\\FundFlow, then refresh this page. Details: ${error.message}`, 'error');
    }
  }

  function openAiPanel() {
    const panel = $('aiPanel');
    panel.hidden = false;
    $('aiChatButton').setAttribute('aria-expanded', 'true');
    const expanded = panel.classList.contains('is-expanded');
    $('aiBackdrop').hidden = !expanded;
    document.body.classList.toggle('ai-expanded', expanded);
    window.setTimeout(() => { if (!panel.hidden && ! $('aiMessageInput').disabled) $('aiMessageInput').focus(); }, 80);
  }

  function closeAiPanel() {
    $('aiPanel').hidden = true;
    $('aiPanel').classList.remove('is-expanded');
    $('aiAssistantWrap').classList.remove('is-expanded');
    $('aiBackdrop').hidden = true;
    $('aiChatButton').setAttribute('aria-expanded', 'false');
    $('aiExpandButton').textContent = '⤢';
    $('aiExpandButton').title = 'Full screen';
    $('aiExpandButton').setAttribute('aria-label', 'Expand assistant to full screen');
    document.body.classList.remove('ai-expanded');
  }

  function toggleAiFullScreen() {
    const panel = $('aiPanel');
    if (panel.hidden) openAiPanel();
    const expanded = !panel.classList.contains('is-expanded');
    panel.classList.toggle('is-expanded', expanded);
    $('aiAssistantWrap').classList.toggle('is-expanded', expanded);
    $('aiBackdrop').hidden = !expanded;
    document.body.classList.toggle('ai-expanded', expanded);
    $('aiExpandButton').textContent = expanded ? '⤡' : '⤢';
    $('aiExpandButton').title = expanded ? 'Exit full screen' : 'Full screen';
    $('aiExpandButton').setAttribute('aria-label', expanded ? 'Exit full screen' : 'Expand assistant to full screen');
    if (expanded) window.setTimeout(() => { if (! $('aiMessageInput').disabled) $('aiMessageInput').focus(); }, 60);
  }

  function wireAiAssistant() {
    const launcher = $('aiChatButton');
    if (!launcher) return;
    // Bind the assistant independently before other page features, so an unrelated
    // missing element elsewhere cannot prevent the AI launcher from working.
    launcher.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if ($('aiPanel').hidden) openAiPanel(); else closeAiPanel();
    });
    $('aiCloseButton').addEventListener('click', (event) => { event.preventDefault(); closeAiPanel(); });
    $('aiExpandButton').addEventListener('click', (event) => { event.preventDefault(); toggleAiFullScreen(); });
    $('aiBackdrop').addEventListener('click', closeAiPanel);
    $('aiChatForm').addEventListener('submit', sendAiMessage);
    $('aiMessageInput').addEventListener('input', (event) => {
      const el = event.target;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    });
    document.querySelectorAll('[data-ai-prompt]').forEach((button) => button.addEventListener('click', () => {
      openAiPanel();
      $('aiMessageInput').value = button.dataset.aiPrompt || '';
      if (aiAvailable) $('aiChatForm').requestSubmit();
      else $('aiMessageInput').focus();
    }));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('aiPanel').hidden) {
        if ($('aiPanel').classList.contains('is-expanded')) { toggleAiFullScreen(); event.stopPropagation(); }
        else closeAiPanel();
      }
    });
  }

  async function sendAiMessage(event) {
    event.preventDefault();
    if (!aiAvailable) { toast('Groq is not configured. Add GROQ_API_KEY to .env and restart npm run app.', 'error'); return; }
    const input = $('aiMessageInput');
    const message = input.value.trim();
    if (!message) return;
    if (message.length > 2000) { toast('Please keep AI messages under 2,000 characters.', 'error'); return; }
    input.value = '';
    input.style.height = 'auto';
    appendAiMessage('user', message);
    aiHistory.push({ role: 'user', content: message });
    const waiting = appendAiMessage('assistant', '', true);
    const sendButton = $('aiSendButton');
    sendButton.disabled = true;
    try {
      const context = state ? {
        role: isAdmin() ? 'Admin' : roleName(currentRole()),
        selectedWallet: shortAddress(state.account),
        chainId: state.chainId,
        requestCount: state.requestCount,
        contractPoolBalance: fmtEth(state.balanceWei),
        pendingRequests: state.requests.filter((r) => r.status === 0 || r.status === 1).length
      } : { role: 'Not connected', chainId: 31337 };
      const result = await api('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message, history: aiHistory.slice(-8), context }) });
      waiting.remove();
      const answer = String(result.answer || 'No response was returned.');
      aiHistory.push({ role: 'assistant', content: answer });
      if (aiHistory.length > 12) aiHistory.splice(0, aiHistory.length - 12);
      appendAiMessage('assistant', answer);
    } catch (error) {
      waiting.remove();
      const detail = String(error?.message || 'Unknown AI error');
      appendAiMessage('assistant', `I couldn't get a response from Groq. ${detail}`);
      setAiStatusMessage(`AI request failed: ${detail}`, 'error');
      toast(`AI request failed: ${detail}`, 'error');
      addNotification('AI assistant error', detail, 'error');
    } finally {
      sendButton.disabled = !aiAvailable;
      input.focus();
    }
  }

  function wireEvents() {
    document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => go(button.dataset.page)));
    document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => go(button.dataset.go)));
    $('connectBtn').addEventListener('click', connectSavedDeployment);
    $('refreshBtn').addEventListener('click', refreshState);
    $('runDemoBtn').addEventListener('click', runFullDemo);
    $('reloadDeploymentBtn').addEventListener('click', connectSavedDeployment);
    $('accountSelect').addEventListener('change', async (event) => { selectedAccount = event.target.value; await refreshState(); });
    $('requestForm').addEventListener('submit', onRequestSubmit);
    $('memberForm').addEventListener('submit', onMemberSubmit);
    ['requestSearch', 'requestFilter'].forEach((id) => $(id).addEventListener('input', renderRequests));
    ['memberSearch', 'memberFilter'].forEach((id) => $(id).addEventListener('input', renderMembers));
    $('activitySearch').addEventListener('input', renderActivity);
    $('exportBtn').addEventListener('click', exportCsv);
    $('fundPoolBtn').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Fund the shared test pool', description: 'Deposit test ETH from the selected unlocked local account into the FundFlow contract.',
        confirmLabel: 'Deposit 10 test ETH',
        body: '<div class="release-amount-block"><span>Deposit amount</span><strong>10 tETH</strong><small>Local Hardhat test currency only</small></div><div class="modal-warning">This increases the shared contract pool balance. It does not create a personal budget for a role or member.</div>'
      });
      if (ok) runTransaction('fund-pool', { amountEth: '10' }, 'Pool funding');
    });
    $('notificationButton').addEventListener('click', () => {
      const panel = $('notificationPanel');
      const open = panel.hidden;
      panel.hidden = !open;
      $('notificationButton').setAttribute('aria-expanded', String(open));
    });
    $('markNotificationsReadBtn').addEventListener('click', () => {
      notificationItems = notificationItems.map((item) => ({ ...item, read: true }));
      persistNotifications(); renderNotifications();
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.notification-shell')) closeNotificationPanel();
      const button = event.target.closest('button[data-action]');
      if (button) handleAction(button);
    });
    $('actionModalCancel').addEventListener('click', () => closeActionModal(null));
    $('actionModalX').addEventListener('click', () => closeActionModal(null));
    $('actionModal').addEventListener('click', (event) => { if (event.target === $('actionModal')) closeActionModal(null); });
    $('actionModalConfirm').addEventListener('click', () => {
      const input = $('modalInput');
      if (modalOptions?.requireInput && !String(input?.value || '').trim()) {
        $('actionModalError').textContent = 'Please enter a reason before continuing.';
        $('actionModalError').hidden = false;
        input?.focus();
        return;
      }
      closeActionModal(input ? input.value.trim() : true);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!$('actionModal').hidden) closeActionModal(null);
        closeNotificationPanel();
      }
    });
  }

  renderNotifications();
  wireAiAssistant();
  wireEvents();
  checkAiStatus();
  const hashPage = window.location.hash.replace('#', '');
  if (PAGE_COPY[hashPage]) go(hashPage);
  checkNode().then(() => refreshState()).catch(() => {});
})();

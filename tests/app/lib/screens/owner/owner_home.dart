import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config.dart';
import '../../services/api.dart';
import '../../services/format.dart';
import '../../widgets/common.dart';
import 'reports_tab.dart';
import 'settings_tab.dart';

class OwnerHome extends StatefulWidget {
  final Map<String, dynamic> profile;
  const OwnerHome({super.key, required this.profile});
  @override
  State<OwnerHome> createState() => _OwnerHomeState();
}

class _OwnerHomeState extends State<OwnerHome> {
  int _tab = 0;
  int _unread = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      DashboardTab(onUnread: (v) => setState(() => _unread = v)),
      const ReportsTab(),
      AlertsTab(onRead: () => setState(() => _unread = 0)),
      SettingsTab(profile: widget.profile),
    ];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Dashibodi'),
          const NavigationDestination(icon: Icon(Icons.bar_chart_outlined), selectedIcon: Icon(Icons.bar_chart), label: 'Ripoti'),
          NavigationDestination(
            icon: Badge(isLabelVisible: _unread > 0, label: Text('$_unread'), child: const Icon(Icons.notifications_outlined)),
            selectedIcon: const Icon(Icons.notifications),
            label: 'Arifa',
          ),
          const NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Mipangilio'),
        ],
      ),
    );
  }
}

// =====================================================================
// DASHIBODI — hali ya vibanda vyote papo hapo
// =====================================================================
class DashboardTab extends StatefulWidget {
  final ValueChanged<int> onUnread;
  const DashboardTab({super.key, required this.onUnread});
  @override
  State<DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends State<DashboardTab> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  RealtimeChannel? _channel;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _load();
    _channel = sb
        .channel('owner-dashboard')
        .onPostgresChanges(event: PostgresChangeEvent.all, schema: 'public', table: 'transactions', callback: (_) => _soon())
        .onPostgresChanges(event: PostgresChangeEvent.all, schema: 'public', table: 'sessions', callback: (_) => _soon())
        .onPostgresChanges(event: PostgresChangeEvent.insert, schema: 'public', table: 'notifications', callback: (_) => _soon())
        .subscribe();
  }

  void _soon() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 800), _load);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    if (_channel != null) sb.removeChannel(_channel!);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.ownerDashboard();
      if (!mounted) return;
      setState(() {
        _data = d;
        _loading = false;
      });
      widget.onUnread((d['unread_alerts'] as num?)?.toInt() ?? 0);
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      showMsg(context, errorText(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final today = (d?['today'] as Map?) ?? {};
    final outlets = (d?['outlets'] as List?) ?? [];
    final until = DateTime.tryParse(d?['subscription_until']?.toString() ?? '');
    final daysLeft = until?.difference(DateTime.now()).inDays;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashibodi'),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh))],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(12), children: [
                if (daysLeft != null && daysLeft < 5)
                  Card(
                    color: daysLeft < 0 ? Colors.red.shade50 : Colors.orange.shade50,
                    child: ListTile(
                      leading: Icon(Icons.warning_amber, color: daysLeft < 0 ? Colors.red : Colors.orange),
                      title: Text(daysLeft < 0
                          ? 'Usajili umeisha — mawakala hawawezi kurekodi miamala'
                          : 'Usajili unaisha baada ya siku $daysLeft'),
                      subtitle: const Text('Lipia kwenye Mipangilio > Usajili'),
                    ),
                  ),
                GridView.count(
                  crossAxisCount: MediaQuery.of(context).size.width > 700 ? 4 : 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  childAspectRatio: 1.9,
                  children: [
                    StatCard(title: 'Miamala leo', value: '${today['tx_count'] ?? 0}', icon: Icons.receipt_long),
                    StatCard(
                        title: 'Kamisheni leo',
                        value: tzs(today['commission']),
                        icon: Icons.payments,
                        color: Colors.green.shade700),
                    StatCard(
                        title: 'Kuweka (deposit)',
                        value: tzs(today['deposits']),
                        icon: Icons.south_west,
                        color: Colors.blue.shade700),
                    StatCard(
                        title: 'Kutoa (withdraw)',
                        value: tzs(today['withdrawals']),
                        icon: Icons.north_east,
                        color: Colors.orange.shade800),
                  ],
                ),
                const SizedBox(height: 12),
                Row(children: [
                  const Text('Vibanda', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                  const Spacer(),
                  Icon(Icons.circle, size: 10, color: Colors.green.shade600),
                  const Text(' Live', style: TextStyle(fontSize: 12)),
                ]),
                const SizedBox(height: 6),
                if (outlets.isEmpty)
                  const EmptyState(
                      icon: Icons.store_outlined, text: 'Bado huna kibanda.\nNenda Mipangilio > Vibanda kuongeza.'),
                for (final o in outlets) _OutletCard(data: Map<String, dynamic>.from(o as Map)),
              ]),
            ),
    );
  }
}

class _OutletCard extends StatelessWidget {
  final Map<String, dynamic> data;
  const _OutletCard({required this.data});

  @override
  Widget build(BuildContext context) {
    final s = data['summary'] as Map?;
    final open = s?['status'] == 'open';
    final closed = s?['status'] == 'closed';
    final floats = (s?['floats'] as List?) ?? [];
    final totalVar = closed
        ? n(s?['cash_variance']) + floats.fold<double>(0, (a, f) => a + n(f['variance']))
        : 0.0;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 5),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: s == null
            ? null
            : () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => SessionDetailScreen(
                      sessionId: s['session_id'].toString(),
                      title: data['outlet_name'].toString(),
                    ),
                  ),
                ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.storefront),
              const SizedBox(width: 8),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(data['outlet_name'].toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  Text(data['agent_name']?.toString() ?? 'Hakuna wakala leo',
                      style: const TextStyle(fontSize: 12, color: Colors.black54)),
                ]),
              ),
              Chip(
                visualDensity: VisualDensity.compact,
                label: Text(open ? 'WAZI' : (closed ? 'IMEFUNGWA' : 'HAIJAFUNGULIWA')),
                backgroundColor: open ? Colors.green.shade50 : (closed ? Colors.grey.shade200 : Colors.orange.shade50),
              ),
            ]),
            if (s != null) ...[
              const Divider(),
              BalanceRow(label: 'Cash', amount: s['expected_cash'], dot: Colors.green),
              for (final f in floats)
                BalanceRow(label: f['label'].toString(), amount: f['expected'], dot: networkOf(f['network']?.toString()).color),
              const Divider(),
              Row(children: [
                Text('Miamala ${s['tx_count']}  •  Kamisheni ${tzs(s['commission'])}',
                    style: const TextStyle(fontSize: 12)),
                const Spacer(),
                if (closed) VarianceText(totalVar, fontSize: 12),
              ]),
            ],
          ]),
        ),
      ),
    );
  }
}

/// Miamala ya zamu moja (mmiliki anaweza kufuta muamala)
class SessionDetailScreen extends StatefulWidget {
  final String sessionId;
  final String title;
  const SessionDetailScreen({super.key, required this.sessionId, required this.title});
  @override
  State<SessionDetailScreen> createState() => _SessionDetailScreenState();
}

class _SessionDetailScreenState extends State<SessionDetailScreen> {
  Map<String, dynamic>? _s;
  List<Map<String, dynamic>> _txs = [];
  List<Map<String, dynamic>> _adjs = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([
        Api.sessionSummary(widget.sessionId),
        Api.sessionTransactions(widget.sessionId),
        Api.sessionAdjustments(widget.sessionId),
      ]);
      if (!mounted) return;
      setState(() {
        _s = r[0] as Map<String, dynamic>;
        _txs = r[1] as List<Map<String, dynamic>>;
        _adjs = r[2] as List<Map<String, dynamic>>;
      });
    } catch (e) {
      if (mounted) showMsg(context, errorText(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _s;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: s == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(12), children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('Siku: ${s['work_date']}  •  ${s['status'] == 'open' ? 'Wazi' : 'Imefungwa'}',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text('Imefunguliwa ${dateTime(s['opened_at'])}'
                          '${s['closed_at'] != null ? '  •  Imefungwa ${dateTime(s['closed_at'])}' : ''}',
                          style: const TextStyle(fontSize: 12, color: Colors.black54)),
                      const Divider(),
                      _row('Cash ya kuanzia', tzs(s['opening_cash'])),
                      _row('Kuweka', tzs(s['deposits'])),
                      _row('Kutoa', tzs(s['withdrawals'])),
                      _row('Matumizi', tzs(s['expenses'])),
                      _row('Kamisheni', tzs(s['commission'])),
                      const Divider(),
                      const Text('Hesabu ya mfumo vs halisi', style: TextStyle(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 4),
                      _recon('Cash', s['expected_cash'], s['closing_cash_counted'], s['cash_variance']),
                      for (final f in (s['floats'] as List? ?? []))
                        _recon(f['label'].toString(), f['expected'], f['counted'], f['variance']),
                    ]),
                  ),
                ),
                const SizedBox(height: 8),
                const Text('Miamala', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                for (final t in _txs)
                  ListTile(
                    dense: true,
                    leading: NetworkChip(t['network'].toString()),
                    title: Text(
                      '${t['tx_type'] == 'deposit' ? 'Kuweka' : 'Kutoa'} ${tzs(t['amount'])}',
                      style: TextStyle(decoration: t['voided'] == true ? TextDecoration.lineThrough : null),
                    ),
                    subtitle: Text([
                      timeOnly(t['created_at']),
                      if ((t['customer_phone'] ?? '').toString().isNotEmpty) t['customer_phone'],
                      if ((t['reference'] ?? '').toString().isNotEmpty) 'Ref ${t['reference']}',
                      if (t['voided'] == true) 'IMEFUTWA: ${t['void_reason']}',
                    ].join(' • ')),
                    trailing: t['voided'] == true
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () async {
                              final reason = await askText(context, 'Futa muamala?', hint: 'Sababu');
                              if (reason == null || reason.isEmpty || !context.mounted) return;
                              if (await runTask(context, () => Api.voidTransaction(t['id'], reason))) _load();
                            },
                          ),
                  ),
                if (_adjs.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  const Text('Marekebisho', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  for (final a in _adjs)
                    ListTile(
                      dense: true,
                      title: Text(adjustmentKinds[a['kind']] ?? a['kind'].toString()),
                      subtitle: Text([
                        timeOnly(a['created_at']),
                        if (a['network'] != null) networkOf(a['network']).label,
                        if ((a['note'] ?? '').toString().isNotEmpty) a['note'],
                      ].join(' • ')),
                      trailing: Text(tzs(a['amount'])),
                    ),
                ],
              ]),
            ),
    );
  }

  Widget _row(String a, String b) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [Expanded(child: Text(a)), Text(b, style: const TextStyle(fontWeight: FontWeight.w600))]),
      );

  Widget _recon(String label, dynamic expected, dynamic counted, dynamic variance) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Expanded(child: Text(label)),
          Expanded(child: Text(tzs(expected), textAlign: TextAlign.right, style: const TextStyle(fontSize: 12))),
          Expanded(
              child: Text(counted == null ? '-' : tzs(counted),
                  textAlign: TextAlign.right, style: const TextStyle(fontSize: 12))),
          const SizedBox(width: 8),
          if (counted != null) VarianceText(variance, fontSize: 12),
        ]),
      );
}

// =====================================================================
// ARIFA
// =====================================================================
class AlertsTab extends StatefulWidget {
  final VoidCallback onRead;
  const AlertsTab({super.key, required this.onRead});
  @override
  State<AlertsTab> createState() => _AlertsTabState();
}

class _AlertsTabState extends State<AlertsTab> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;

  static const _icons = {
    'large_tx': Icons.trending_up,
    'low_float': Icons.battery_alert,
    'low_cash': Icons.money_off,
    'variance': Icons.warning_amber,
    'void': Icons.delete_outline,
    'daily_report': Icons.summarize,
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.notifications();
      if (!mounted) return;
      setState(() {
        _items = r;
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Arifa'), actions: [
        IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
        TextButton(
          onPressed: () async {
            await runTask(context, Api.markAllRead);
            widget.onRead();
            _load();
          },
          child: const Text('Zote zimesomwa'),
        ),
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _items.isEmpty
              ? const EmptyState(icon: Icons.notifications_none, text: 'Hakuna arifa bado')
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    itemCount: _items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final a = _items[i];
                      final unread = a['read'] != true;
                      return ListTile(
                        tileColor: unread ? Colors.blue.withValues(alpha: 0.05) : null,
                        leading: Icon(_icons[a['kind']] ?? Icons.notifications,
                            color: a['kind'] == 'variance' ? Colors.red : null),
                        title: Text(a['message'].toString().replaceFirst('WakalaLink: ', ''),
                            style: TextStyle(fontWeight: unread ? FontWeight.w700 : FontWeight.normal)),
                        subtitle: Text(AppConfig.smsEnabled ? '${dateTime(a['created_at'])}  •  SMS: ${a['status']}' : dateTime(a['created_at'])),
                      );
                    },
                  ),
                ),
    );
  }
}

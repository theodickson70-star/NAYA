import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config.dart';
import '../../services/api.dart';
import '../../services/format.dart';
import '../../theme.dart';
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

    final open = outlets.where((o) => ((o as Map)['summary'] as Map?)?['status'] == 'open').length;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: const BrandMark(size: 32),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh), tooltip: 'Onyesha upya')],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.fromLTRB(14, 4, 14, 14), children: [
                if (daysLeft != null && daysLeft < 5)
                  Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: daysLeft < 0 ? Naya.dangerBg : Naya.goldSoft,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Row(children: [
                      Icon(Icons.warning_amber_rounded, color: daysLeft < 0 ? Naya.danger : Naya.goldInk),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(
                            daysLeft < 0
                                ? 'Usajili umeisha — mawakala hawawezi kurekodi miamala'
                                : 'Usajili unaisha baada ya siku $daysLeft',
                            style: TextStyle(
                                fontWeight: FontWeight.w700, color: daysLeft < 0 ? Naya.danger : Naya.goldInk),
                          ),
                          const Text('Lipia kwenye Mipangilio > Usajili', style: TextStyle(fontSize: 12, color: Naya.muted)),
                        ]),
                      ),
                    ]),
                  ),
                // Muhtasari wa leo
                HeroPanel(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Text('Leo', style: display(16, color: Colors.white)),
                      const Spacer(),
                      const CircleAvatar(radius: 4, backgroundColor: Naya.gold),
                      const SizedBox(width: 6),
                      Text('Live  •  vibanda $open/${outlets.length} viko wazi',
                          style: TextStyle(fontSize: 12, color: Colors.white.withValues(alpha: 0.75))),
                    ]),
                    const SizedBox(height: 14),
                    Text('Kamisheni ya leo', style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 13)),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(tzs(today['commission']), style: display(34, color: Naya.gold)),
                    ),
                    const SizedBox(height: 14),
                    Container(height: 1, color: Colors.white.withValues(alpha: 0.12)),
                    const SizedBox(height: 12),
                    Row(children: [
                      Expanded(child: HeroStat(label: 'Miamala', value: '${today['tx_count'] ?? 0}')),
                      Expanded(child: HeroStat(label: 'Kuweka', value: tzs(today['deposits']))),
                      Expanded(child: HeroStat(label: 'Kutoa', value: tzs(today['withdrawals']))),
                    ]),
                  ]),
                ),
                const SectionTitle('Vibanda', hint: 'Bonyeza kibanda kuona miamala yake yote'),
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
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: open ? Naya.mint : Naya.bg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.storefront, color: open ? Naya.green : Naya.muted, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(data['outlet_name'].toString(), style: display(17)),
                  Text(data['agent_name']?.toString() ?? 'Hakuna wakala leo',
                      style: const TextStyle(fontSize: 12, color: Naya.muted)),
                ]),
              ),
              StatusPill(
                open ? 'WAZI' : (closed ? 'IMEFUNGWA' : 'HAIJAFUNGULIWA'),
                color: open ? Naya.green : (closed ? Naya.muted : Naya.goldInk),
                background: open ? Naya.mint : (closed ? Naya.bg : Naya.goldSoft),
              ),
            ]),
            if (s != null) ...[
              const Divider(),
              BalanceRow(label: 'Cash', amount: s['expected_cash'], dot: Naya.green),
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
                          style: const TextStyle(fontSize: 12, color: Naya.muted)),
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
                const Text('Miamala', style: TextStyle(fontFamily: kDisplayFont, fontWeight: FontWeight.w800, fontSize: 16)),
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
                      if ((t['profiles'] as Map?)?['full_name'] != null) (t['profiles'] as Map)['full_name'],
                      if (t['voided'] == true) 'IMEBATILISHWA: ${t['void_reason']}',
                    ].join(' • ')),
                    trailing: Text(n(t['commission']) > 0 ? '+${plain(t['commission'])}' : '',
                        style: const TextStyle(color: Naya.green, fontWeight: FontWeight.w700, fontSize: 12)),
                  ),
                if (_adjs.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  const Text('Marekebisho', style: TextStyle(fontFamily: kDisplayFont, fontWeight: FontWeight.w800, fontSize: 16)),
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
                        tileColor: unread ? Naya.green.withValues(alpha: 0.05) : null,
                        leading: Icon(_icons[a['kind']] ?? Icons.notifications,
                            color: a['kind'] == 'variance' ? Naya.danger : null),
                        title: Text(a['message'].toString().replaceFirst(RegExp(r'^(WakalaLink|PayPoint): '), ''),
                            style: TextStyle(fontWeight: unread ? FontWeight.w700 : FontWeight.normal)),
                        subtitle: Text(AppConfig.smsEnabled ? '${dateTime(a['created_at'])}  •  SMS: ${a['status']}' : dateTime(a['created_at'])),
                      );
                    },
                  ),
                ),
    );
  }
}

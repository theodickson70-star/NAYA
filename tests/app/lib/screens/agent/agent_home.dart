import 'package:flutter/material.dart';

import '../../services/api.dart';
import '../../services/format.dart';
import '../../widgets/common.dart';
import 'agent_forms.dart';

class AgentHome extends StatefulWidget {
  final Map<String, dynamic> profile;
  const AgentHome({super.key, required this.profile});
  @override
  State<AgentHome> createState() => _AgentHomeState();
}

class _AgentHomeState extends State<AgentHome> {
  bool _loading = true;
  String? _sessionId;
  Map<String, dynamic>? _summary;
  List<Map<String, dynamic>> _txs = [];
  List<Map<String, dynamic>> _adjs = [];
  List<String> _networks = networks.map((e) => e.code).toList();

  String get _outletName => (widget.profile['outlets'] as Map?)?['name']?.toString() ?? 'Kibanda';
  String? get _outletId => widget.profile['outlet_id'] as String?;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      if (_outletId != null) {
        final lines = await Api.outletLines(_outletId!);
        if (lines.isNotEmpty) _networks = lines.map((e) => e['network'].toString()).toList();
      }
      _sessionId = await Api.myOpenSession();
      if (_sessionId != null) {
        final r = await Future.wait([
          Api.sessionSummary(_sessionId!),
          Api.sessionTransactions(_sessionId!),
          Api.sessionAdjustments(_sessionId!),
        ]);
        _summary = r[0] as Map<String, dynamic>;
        _txs = r[1] as List<Map<String, dynamic>>;
        _adjs = r[2] as List<Map<String, dynamic>>;
      } else {
        _summary = null;
        _txs = [];
        _adjs = [];
      }
    } catch (e) {
      if (mounted) showMsg(context, errorText(e), error: true);
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _newTx(String type) async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => TransactionSheet(type: type, networks: _networks),
    );
    if (ok == true) _load();
  }

  Future<void> _adjust() async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => AdjustmentSheet(networks: _networks),
    );
    if (ok == true) _load();
  }

  Future<void> _void(Map<String, dynamic> t) async {
    if (t['voided'] == true) return;
    final reason = await askText(context, 'Futa muamala wa ${tzs(t['amount'])}?', hint: 'Sababu (lazima)');
    if (reason == null || reason.isEmpty || !mounted) return;
    final ok = await runTask(context, () => Api.voidTransaction(t['id'], reason), success: 'Muamala umefutwa');
    if (ok) _load();
  }

  Future<void> _closeDay() async {
    final floats = ((_summary?['floats'] as List?) ?? []).map((e) => e['network'].toString()).toList();
    final result = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(builder: (_) => CloseDayScreen(networks: floats.isEmpty ? _networks : floats)),
    );
    if (result != null && mounted) {
      await showDialog(context: context, builder: (_) => CloseResultDialog(result: result));
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_outletName),
          Text(widget.profile['full_name']?.toString() ?? '', style: const TextStyle(fontSize: 12)),
        ]),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
          IconButton(
            onPressed: () async {
              if (await confirm(context, 'Toka', 'Unataka kutoka kwenye akaunti?')) sb.auth.signOut();
            },
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _outletId == null
              ? const EmptyState(icon: Icons.store_mall_directory_outlined, text: 'Hujapangiwa kibanda bado.\nWasiliana na mmiliki.')
              : _sessionId == null
                  ? OpenDayView(networks: _networks, onOpened: _load)
                  : _sessionView(),
    );
  }

  Widget _sessionView() {
    final s = _summary!;
    final floats = (s['floats'] as List?) ?? [];
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(12), children: [
        Row(children: [
          Expanded(
              child: StatCard(
                  title: 'Miamala leo', value: '${s['tx_count'] ?? 0}', icon: Icons.receipt_long)),
          Expanded(
              child: StatCard(
                  title: 'Kamisheni',
                  value: tzs(s['commission']),
                  icon: Icons.payments_outlined,
                  color: Colors.green.shade700)),
        ]),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                const Text('Salio la sasa (kwa hesabu)', style: TextStyle(fontWeight: FontWeight.w700)),
                const Spacer(),
                Text('Tangu ${timeOnly(s['opened_at'])}', style: const TextStyle(fontSize: 12, color: Colors.black54)),
              ]),
              const Divider(),
              BalanceRow(label: 'CASH mkononi', amount: s['expected_cash'], dot: Colors.green),
              for (final f in floats)
                BalanceRow(
                  label: 'Float ${f['label']}',
                  amount: f['expected'],
                  dot: networkOf(f['network']?.toString()).color,
                ),
            ]),
          ),
        ),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: _bigButton('KUWEKA', 'Mteja anaweka pesa', Icons.south_west, Colors.blue.shade700,
                () => _newTx('deposit')),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _bigButton('KUTOA', 'Mteja anatoa pesa', Icons.north_east, Colors.orange.shade800,
                () => _newTx('withdrawal')),
          ),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _adjust,
              icon: const Icon(Icons.swap_horiz),
              label: const Text('Float / Mtaji / Matumizi'),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: FilledButton.tonalIcon(
              onPressed: _closeDay,
              icon: const Icon(Icons.lock_clock),
              label: const Text('Funga siku'),
            ),
          ),
        ]),
        const SizedBox(height: 16),
        const Text('Miamala ya leo', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        const Text('Bonyeza kwa muda mrefu kufuta muamala uliokosewa',
            style: TextStyle(fontSize: 11, color: Colors.black54)),
        const SizedBox(height: 4),
        if (_txs.isEmpty) const EmptyState(icon: Icons.receipt_long_outlined, text: 'Bado hakuna muamala'),
        for (final t in _txs) _txTile(t),
        if (_adjs.isNotEmpty) ...[
          const SizedBox(height: 16),
          const Text('Marekebisho', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          for (final a in _adjs)
            ListTile(
              dense: true,
              leading: const Icon(Icons.swap_horiz),
              title: Text(adjustmentKinds[a['kind']] ?? a['kind'].toString()),
              subtitle: Text([
                if (a['network'] != null) networkOf(a['network']).label,
                if ((a['note'] ?? '').toString().isNotEmpty) a['note'],
                timeOnly(a['created_at']),
              ].join(' • ')),
              trailing: Text(tzs(a['amount']), style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
        ],
        const SizedBox(height: 40),
      ]),
    );
  }

  Widget _bigButton(String title, String sub, IconData icon, Color color, VoidCallback onTap) {
    return Material(
      color: color,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 12),
          child: Column(children: [
            Icon(icon, color: Colors.white, size: 32),
            const SizedBox(height: 6),
            Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 18)),
            Text(sub, style: const TextStyle(color: Colors.white70, fontSize: 11)),
          ]),
        ),
      ),
    );
  }

  Widget _txTile(Map<String, dynamic> t) {
    final deposit = t['tx_type'] == 'deposit';
    final voided = t['voided'] == true;
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 3),
      child: ListTile(
        onLongPress: () => _void(t),
        leading: CircleAvatar(
          backgroundColor: (deposit ? Colors.blue : Colors.orange).withValues(alpha: 0.15),
          child: Icon(deposit ? Icons.south_west : Icons.north_east,
              color: deposit ? Colors.blue.shade700 : Colors.orange.shade800),
        ),
        title: Row(children: [
          Text(tzs(t['amount']),
              style: TextStyle(
                  fontWeight: FontWeight.bold, decoration: voided ? TextDecoration.lineThrough : null)),
          const SizedBox(width: 8),
          NetworkChip(t['network'].toString()),
        ]),
        subtitle: Text([
          deposit ? 'Kuweka' : 'Kutoa',
          if ((t['customer_phone'] ?? '').toString().isNotEmpty) t['customer_phone'],
          if ((t['reference'] ?? '').toString().isNotEmpty) 'Ref ${t['reference']}',
          if (voided) 'IMEFUTWA: ${t['void_reason']}',
        ].join(' • ')),
        trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(timeOnly(t['created_at']), style: const TextStyle(fontSize: 12)),
          if (n(t['commission']) > 0)
            Text('+${plain(t['commission'])}', style: TextStyle(fontSize: 12, color: Colors.green.shade700)),
        ]),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../../services/api.dart';
import '../../services/format.dart';
import '../../theme.dart';
import '../../widgets/common.dart';

/// Kumbukumbu (audit log): kila kitendo kwenye biashara — nani, nini, saa ngapi.
/// Haziwezi kubadilishwa wala kufutwa na mtu yeyote.
class AuditScreen extends StatefulWidget {
  const AuditScreen({super.key});
  @override
  State<AuditScreen> createState() => _AuditScreenState();
}

const _actions = <String, String>{
  'kuweka': 'Kuweka',
  'kutoa': 'Kutoa',
  'batilisha': 'Kubatilisha',
  'float': 'Float',
  'mtaji': 'Mtaji',
  'matumizi': 'Matumizi',
  'fungua_siku': 'Kufungua siku',
  'funga_siku': 'Kufunga siku',
  'login': 'Kuingia',
  'logout': 'Kutoka',
  'mfanyakazi': 'Wafanyakazi',
  'mteja': 'Wateja',
  'kibanda': 'Vibanda',
  'kamisheni': 'Kamisheni',
  'mipangilio': 'Mipangilio',
  'usajili': 'Usajili',
};

const _icons = <String, IconData>{
  'kuweka': Icons.south_west,
  'kutoa': Icons.north_east,
  'batilisha': Icons.block,
  'float': Icons.swap_horiz,
  'mtaji': Icons.account_balance_wallet_outlined,
  'matumizi': Icons.shopping_bag_outlined,
  'fungua_siku': Icons.wb_sunny_outlined,
  'funga_siku': Icons.lock_clock,
  'login': Icons.login,
  'logout': Icons.logout,
  'mfanyakazi': Icons.badge_outlined,
  'mteja': Icons.person_outline,
  'kibanda': Icons.storefront,
  'kamisheni': Icons.percent,
  'mipangilio': Icons.tune,
  'usajili': Icons.workspace_premium_outlined,
};

class _AuditScreenState extends State<AuditScreen> {
  String _period = 'leo';
  String? _action;
  String? _actor;
  List<Map<String, dynamic>> _agents = [];
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Api.agents().then((a) {
      if (mounted) setState(() => _agents = a);
    });
    _load();
  }

  (DateTime?, DateTime?) _rangeOf(String p) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    switch (p) {
      case 'leo':
        return (today, today);
      case 'wiki':
        return (today.subtract(const Duration(days: 6)), today);
      case 'mwezi':
        return (DateTime(now.year, now.month, 1), today);
      default:
        return (null, null);
    }
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final (from, to) = _rangeOf(_period);
      final r = await Api.auditList(from: from, to: to, action: _action, actorId: _actor);
      if (mounted) setState(() => _items = r);
    } catch (e) {
      if (mounted) showMsg(context, errorText(e), error: true);
    }
    if (mounted) setState(() => _loading = false);
  }

  Color _color(String a) {
    switch (a) {
      case 'kuweka':
        return Naya.deposit;
      case 'kutoa':
        return Naya.withdraw;
      case 'batilisha':
        return Naya.danger;
      case 'funga_siku':
        return Naya.greenDark;
      default:
        return Naya.muted;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Panga kwa siku
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final a in _items) {
      final d = DateTime.tryParse(a['created_at'].toString())?.toLocal();
      final key = d == null ? '-' : niceDate(d);
      groups.putIfAbsent(key, () => []).add(a);
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Kumbukumbu')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(14, 4, 14, 24), children: [
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final p in const {'leo': 'Leo', 'wiki': 'Siku 7', 'mwezi': 'Mwezi huu', 'zote': 'Zote'}.entries)
              ChoiceChip(
                label: Text(p.value),
                selected: _period == p.key,
                onSelected: (_) {
                  setState(() => _period = p.key);
                  _load();
                },
              ),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: DropdownButtonFormField<String?>(
                value: _action,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Kitendo', isDense: true),
                items: [
                  const DropdownMenuItem<String?>(value: null, child: Text('Vyote')),
                  for (final e in _actions.entries) DropdownMenuItem<String?>(value: e.key, child: Text(e.value)),
                ],
                onChanged: (v) {
                  setState(() => _action = v);
                  _load();
                },
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: DropdownButtonFormField<String?>(
                value: _actor,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Mfanyakazi', isDense: true),
                items: [
                  const DropdownMenuItem<String?>(value: null, child: Text('Wote')),
                  for (final a in _agents)
                    DropdownMenuItem<String?>(value: a['id'].toString(), child: Text(a['full_name']?.toString() ?? '-')),
                ],
                onChanged: (v) {
                  setState(() => _actor = v);
                  _load();
                },
              ),
            ),
          ]),
          const SizedBox(height: 6),
          const Text('Kumbukumbu haziwezi kubadilishwa wala kufutwa na mtu yeyote.',
              style: TextStyle(fontSize: 12, color: Naya.muted)),
          if (_loading) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator(minHeight: 2)),
          if (!_loading && _items.isEmpty)
            const EmptyState(icon: Icons.history_edu_outlined, text: 'Hakuna kumbukumbu kwa kipindi hiki'),
          for (final g in groups.entries) ...[
            SectionTitle(g.key),
            Card(
              child: Column(children: [
                for (final a in g.value)
                  ListTile(
                    leading: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: _color(a['action'].toString()).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(_icons[a['action']] ?? Icons.history, size: 18, color: _color(a['action'].toString())),
                    ),
                    title: Text(a['details'].toString()),
                    subtitle: Text(
                        '${a['actor_name'] ?? 'Mfumo'} • ${_actions[a['action']] ?? a['action']} • ${timeOnly(a['created_at'])}'),
                  ),
              ]),
            ),
          ],
        ]),
      ),
    );
  }
}

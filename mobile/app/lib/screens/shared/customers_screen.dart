import 'dart:async';

import 'package:flutter/material.dart';

import '../../services/api.dart';
import '../../services/format.dart';
import '../../theme.dart';
import '../../widgets/common.dart';

/// Daftari la wateja — wakala na mmiliki. Mteja anasajiliwa pia yenyewe akiwekwa kwenye muamala.
/// Salio la mteja haliko hapa (liko kwa mtandao wake); hapa ni jina, simu na historia ya miamala.
class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key});
  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Api.customers(search: _search.text.trim());
      if (mounted) setState(() => _items = r);
    } catch (e) {
      if (mounted) showMsg(context, errorText(e), error: true);
    }
    if (mounted) setState(() => _loading = false);
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _load);
  }

  Future<void> _add() async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => const CustomerFormSheet(),
    );
    if (ok == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Wateja')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _add,
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Ongeza mteja'),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
          child: TextField(
            controller: _search,
            onChanged: _onSearch,
            decoration: const InputDecoration(hintText: 'Tafuta kwa jina au namba ya simu', prefixIcon: Icon(Icons.search)),
          ),
        ),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: _items.isEmpty && !_loading
                ? ListView(children: const [
                    SizedBox(height: 60),
                    EmptyState(
                      icon: Icons.people_outline,
                      text: 'Hakuna mteja bado.\nWateja wanaongezwa wenyewe ukiweka namba yao kwenye muamala.',
                    ),
                  ])
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(14, 0, 14, 90),
                    itemCount: _items.length,
                    itemBuilder: (_, i) => _tile(_items[i]),
                  ),
          ),
        ),
      ]),
    );
  }

  Widget _tile(Map<String, dynamic> c) {
    final name = (c['full_name'] ?? '').toString().trim();
    return Card(
      child: ListTile(
        onTap: () async {
          await Navigator.push(context, MaterialPageRoute(builder: (_) => CustomerDetailScreen(customer: c)));
          _load();
        },
        leading: CircleAvatar(
          backgroundColor: Naya.mint,
          child: Text(name.isEmpty ? '#' : name[0].toUpperCase(),
              style: const TextStyle(color: Naya.green, fontWeight: FontWeight.w700)),
        ),
        title: Text(name.isEmpty ? 'Bila jina' : name, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(phoneLocal(c['phone'])),
        trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('${c['tx_count'] ?? 0} miamala', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          if (c['last_tx'] != null)
            Text(dateTime(c['last_tx']), style: const TextStyle(fontSize: 11, color: Naya.muted)),
        ]),
      ),
    );
  }
}

/// Kuongeza au kubadilisha mteja
class CustomerFormSheet extends StatefulWidget {
  final Map<String, dynamic>? customer;
  const CustomerFormSheet({super.key, this.customer});
  @override
  State<CustomerFormSheet> createState() => _CustomerFormSheetState();
}

class _CustomerFormSheetState extends State<CustomerFormSheet> {
  final _form = GlobalKey<FormState>();
  late final _phone = TextEditingController(
      text: widget.customer == null ? '' : phoneLocal(widget.customer!['phone']).replaceAll(' ', ''));
  late final _name = TextEditingController(text: widget.customer?['full_name']?.toString() ?? '');
  late final _notes = TextEditingController(text: widget.customer?['notes']?.toString() ?? '');
  bool _busy = false;

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final ok = await runTask(
      context,
      () => Api.saveCustomer(_phone.text.trim(), _name.text.trim(), notes: _notes.text.trim()),
      success: 'Mteja amehifadhiwa',
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.customer != null;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Form(
        key: _form,
        child: ListView(shrinkWrap: true, padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), children: [
          Text(editing ? 'Badilisha mteja' : 'Mteja mpya', style: display(20)),
          const SizedBox(height: 12),
          TextFormField(
            controller: _phone,
            enabled: !editing,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Namba ya simu', hintText: '07XXXXXXXX', prefixIcon: Icon(Icons.phone)),
            validator: (v) => (v == null || v.replaceAll(RegExp(r'\D'), '').length < 9) ? 'Weka namba sahihi' : null,
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Jina la mteja', prefixIcon: Icon(Icons.person)),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Andika jina' : null,
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _notes,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'Maelezo (hiari)', prefixIcon: Icon(Icons.notes)),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: Text(editing ? 'Hifadhi mabadiliko' : 'Hifadhi mteja'),
          ),
        ]),
      ),
    );
  }
}

/// Mteja mmoja: taarifa zake na miamala yake (wakala anaona miamala yake tu na mteja huyu)
class CustomerDetailScreen extends StatefulWidget {
  final Map<String, dynamic> customer;
  const CustomerDetailScreen({super.key, required this.customer});
  @override
  State<CustomerDetailScreen> createState() => _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends State<CustomerDetailScreen> {
  late Map<String, dynamic> _c = widget.customer;
  List<Map<String, dynamic>> _txs = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final t = await Api.customerTransactions(_c['id'].toString());
      if (mounted) setState(() => _txs = t);
    } catch (e) {
      if (mounted) showMsg(context, errorText(e), error: true);
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _edit() async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CustomerFormSheet(customer: _c),
    );
    if (ok == true) {
      final fresh = await Api.customerByPhone(_c['phone'].toString());
      if (fresh != null && mounted) setState(() => _c = {..._c, ...fresh});
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = (_c['full_name'] ?? '').toString().trim();
    final live = _txs.where((t) => t['voided'] != true);
    final dep = live.where((t) => t['tx_type'] == 'deposit').fold<double>(0, (a, t) => a + n(t['amount']));
    final wd = live.where((t) => t['tx_type'] == 'withdrawal').fold<double>(0, (a, t) => a + n(t['amount']));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mteja'),
        actions: [IconButton(onPressed: _edit, icon: const Icon(Icons.edit_outlined), tooltip: 'Badilisha')],
      ),
      body: ListView(padding: const EdgeInsets.fromLTRB(14, 4, 14, 24), children: [
        HeroPanel(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(name.isEmpty ? 'Bila jina' : name, style: display(26, color: Colors.white)),
            const SizedBox(height: 4),
            Text(phoneLocal(_c['phone']), style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 15)),
            if ((_c['notes'] ?? '').toString().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(_c['notes'].toString(), style: const TextStyle(color: Naya.gold)),
            ],
            const SizedBox(height: 14),
            Row(children: [
              Expanded(child: HeroStat(label: 'Miamala', value: '${live.length}')),
              Expanded(child: HeroStat(label: 'Ameweka', value: tzs(dep))),
              Expanded(child: HeroStat(label: 'Ametoa', value: tzs(wd))),
            ]),
          ]),
        ),
        const SectionTitle('Miamala', hint: 'Salio la mteja liko kwenye mtandao wake, si kwenye PayPoint'),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        if (!_loading && _txs.isEmpty) const EmptyState(icon: Icons.receipt_long_outlined, text: 'Hakuna muamala bado'),
        for (final t in _txs)
          Card(
            child: ListTile(
              leading: NetworkChip(t['network'].toString()),
              title: Text(
                '${t['tx_type'] == 'deposit' ? 'Kuweka' : 'Kutoa'} ${tzs(t['amount'])}',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  decoration: t['voided'] == true ? TextDecoration.lineThrough : null,
                ),
              ),
              subtitle: Text([
                dateTime(t['created_at']),
                if ((t['outlets'] as Map?)?['name'] != null) (t['outlets'] as Map)['name'],
                if ((t['profiles'] as Map?)?['full_name'] != null) (t['profiles'] as Map)['full_name'],
                if (t['voided'] == true) 'IMEBATILISHWA',
              ].join(' • ')),
            ),
          ),
      ]),
    );
  }
}

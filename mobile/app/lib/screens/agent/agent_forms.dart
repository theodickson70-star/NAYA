import 'package:flutter/material.dart';

import '../../services/api.dart';
import '../../services/format.dart';
import '../../widgets/common.dart';
import '../../theme.dart';

/// Kufungua siku: cash ya mwanzo + float ya kila mtandao
class OpenDayView extends StatefulWidget {
  final List<String> networks;
  final VoidCallback onOpened;
  const OpenDayView({super.key, required this.networks, required this.onOpened});
  @override
  State<OpenDayView> createState() => _OpenDayViewState();
}

class _OpenDayViewState extends State<OpenDayView> {
  final _form = GlobalKey<FormState>();
  final _cash = TextEditingController();
  late final Map<String, TextEditingController> _floats = {
    for (final n in widget.networks) n: TextEditingController(),
  };
  bool _busy = false;

  Future<void> _open() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final ok = await runTask(
      context,
      () => Api.openSession(
        parseAmount(_cash.text),
        _floats.entries.map((e) => {'network': e.key, 'amount': parseAmount(e.value.text)}).toList(),
      ),
      success: 'Siku imefunguliwa. Kazi njema!',
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) widget.onOpened();
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _form,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        const Icon(Icons.wb_sunny_outlined, size: 48, color: Naya.gold),
        const SizedBox(height: 8),
        const Text('Fungua siku ya kazi',
            textAlign: TextAlign.center, style: TextStyle(fontFamily: kDisplayFont, fontSize: 20, fontWeight: FontWeight.w800)),
        const Text('Hesabu cash uliyonayo na angalia salio la float kwenye kila laini.',
            textAlign: TextAlign.center, style: TextStyle(color: Naya.muted)),
        const SizedBox(height: 20),
        MoneyField(controller: _cash, label: 'Cash ya kuanzia'),
        const SizedBox(height: 16),
        const Text('Float ya kuanzia', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        for (final e in _floats.entries) ...[
          MoneyField(controller: e.value, label: networkOf(e.key).label),
          const SizedBox(height: 10),
        ],
        const SizedBox(height: 8),
        FilledButton.icon(
          onPressed: _busy ? null : _open,
          style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
          icon: const Icon(Icons.play_arrow),
          label: const Text('Fungua siku'),
        ),
      ]),
    );
  }
}

/// Fomu ya muamala (Kuweka / Kutoa)
class TransactionSheet extends StatefulWidget {
  final String type;
  final List<String> networks;
  const TransactionSheet({super.key, required this.type, required this.networks});
  @override
  State<TransactionSheet> createState() => _TransactionSheetState();
}

class _TransactionSheetState extends State<TransactionSheet> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _phone = TextEditingController();
  final _name = TextEditingController();
  final _ref = TextEditingController();
  final _comm = TextEditingController();
  late String _network = widget.networks.first;
  bool _busy = false;
  String? _known; // jina la mteja aliyesajiliwa tayari
  String _lastLookup = '';

  bool get _deposit => widget.type == 'deposit';

  /// Namba ikikamilika, tafuta mteja kwenye daftari na ujaze jina lake
  Future<void> _lookup(String v) async {
    final digits = v.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 10 || digits == _lastLookup) {
      if (digits.length < 10 && _known != null) setState(() => _known = null);
      return;
    }
    _lastLookup = digits;
    try {
      final c = await Api.customerByPhone(v);
      if (!mounted) return;
      final name = c?['full_name']?.toString();
      setState(() => _known = c == null ? null : (name ?? ''));
      if (name != null && name.isNotEmpty && _name.text.trim().isEmpty) _name.text = name;
    } catch (_) {}
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final ok = await runTask(
      context,
      () => Api.recordTransaction(
        network: _network,
        type: widget.type,
        amount: parseAmount(_amount.text),
        phone: _phone.text.trim(),
        name: _name.text.trim(),
        reference: _ref.text.trim(),
        commission: _comm.text.trim().isEmpty ? null : parseAmount(_comm.text),
      ),
      success: 'Muamala umehifadhiwa',
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final color = _deposit ? Naya.deposit : Naya.withdraw;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Form(
        key: _form,
        child: ListView(shrinkWrap: true, padding: const EdgeInsets.all(16), children: [
          Text(_deposit ? 'KUWEKA PESA' : 'KUTOA PESA',
              style: TextStyle(fontFamily: kDisplayFont, fontSize: 20, fontWeight: FontWeight.w800, color: color)),
          Text(_deposit ? 'Mteja amekupa cash, umemtumia float' : 'Mteja amekutumia float, umempa cash',
              style: const TextStyle(color: Naya.muted)),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final code in widget.networks)
              ChoiceChip(
                label: Text(networkOf(code).label),
                selected: _network == code,
                selectedColor: networkOf(code).color.withValues(alpha: 0.2),
                onSelected: (_) => setState(() => _network = code),
              ),
          ]),
          const SizedBox(height: 12),
          MoneyField(controller: _amount, label: 'Kiasi', autofocus: true),
          const SizedBox(height: 10),
          TextFormField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            onChanged: _lookup,
            decoration: InputDecoration(
              labelText: 'Simu ya mteja (hiari)',
              prefixIcon: const Icon(Icons.phone),
              helperText: _known == null
                  ? 'Mteja mpya atasajiliwa kwenye daftari lako'
                  : 'Mteja yupo kwenye daftari${_known!.isEmpty ? '' : ': $_known'}',
              helperStyle: TextStyle(color: _known == null ? Naya.muted : Naya.green),
            ),
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Jina la mteja (hiari)', prefixIcon: Icon(Icons.person)),
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _ref,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
                labelText: 'Namba ya muamala / Ref (hiari)', prefixIcon: Icon(Icons.confirmation_number)),
          ),
          const SizedBox(height: 10),
          MoneyField(controller: _comm, label: 'Kamisheni (acha wazi ihesabiwe yenyewe)', required: false),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            style: FilledButton.styleFrom(
              backgroundColor: _deposit ? Naya.green : Naya.gold,
              foregroundColor: _deposit ? Colors.white : Naya.goldOn,
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
            child: const Text('Hifadhi muamala'),
          ),
        ]),
      ),
    );
  }
}

/// Marekebisho: mtaji, kununua/kuuza float, matumizi
class AdjustmentSheet extends StatefulWidget {
  final List<String> networks;
  const AdjustmentSheet({super.key, required this.networks});
  @override
  State<AdjustmentSheet> createState() => _AdjustmentSheetState();
}

class _AdjustmentSheetState extends State<AdjustmentSheet> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _kind = 'buy_float';
  late String _network = widget.networks.first;
  bool _busy = false;

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final ok = await runTask(
      context,
      () => Api.recordAdjustment(
          _kind, kindNeedsNetwork(_kind) ? _network : null, parseAmount(_amount.text), _note.text.trim()),
      success: 'Imehifadhiwa',
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Form(
        key: _form,
        child: ListView(shrinkWrap: true, padding: const EdgeInsets.all(16), children: [
          const Text('Float / Mtaji / Matumizi', style: TextStyle(fontFamily: kDisplayFont, fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _kind,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Aina'),
            items: adjustmentKinds.entries
                .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                .toList(),
            onChanged: (v) => setState(() => _kind = v!),
          ),
          if (kindNeedsNetwork(_kind)) ...[
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              value: _network,
              decoration: const InputDecoration(labelText: 'Mtandao'),
              items: widget.networks
                  .map((c) => DropdownMenuItem(value: c, child: Text(networkOf(c).label)))
                  .toList(),
              onChanged: (v) => setState(() => _network = v!),
            ),
          ],
          const SizedBox(height: 10),
          MoneyField(controller: _amount, label: 'Kiasi', autofocus: true),
          const SizedBox(height: 10),
          TextFormField(
            controller: _note,
            decoration: const InputDecoration(labelText: 'Maelezo (hiari)'),
            validator: (v) => (_kind == 'expense' && (v == null || v.trim().isEmpty)) ? 'Eleza matumizi' : null,
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            child: const Text('Hifadhi'),
          ),
        ]),
      ),
    );
  }
}

/// Kufunga siku — wakala anahesabu bila kuona kiasi kinachotarajiwa (blind count)
class CloseDayScreen extends StatefulWidget {
  final List<String> networks;
  const CloseDayScreen({super.key, required this.networks});
  @override
  State<CloseDayScreen> createState() => _CloseDayScreenState();
}

class _CloseDayScreenState extends State<CloseDayScreen> {
  final _form = GlobalKey<FormState>();
  final _cash = TextEditingController();
  final _notes = TextEditingController();
  late final Map<String, TextEditingController> _floats = {
    for (final n in widget.networks) n: TextEditingController(),
  };
  bool _busy = false;

  Future<void> _close() async {
    if (!_form.currentState!.validate()) return;
    if (!await confirm(context, 'Funga siku?', 'Hakikisha umehesabu cash na float kwa usahihi. Huwezi kubadilisha baada ya kufunga.')) {
      return;
    }
    setState(() => _busy = true);
    Map<String, dynamic>? result;
    final ok = await runTask(context, () async {
      result = await Api.closeSession(
        parseAmount(_cash.text),
        _floats.entries.map((e) => {'network': e.key, 'amount': parseAmount(e.value.text)}).toList(),
        _notes.text.trim(),
      );
    });
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.pop(context, result);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Funga siku')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          const Card(
            color: Color(0xFFFFF8E1),
            child: Padding(
              padding: EdgeInsets.all(12),
              child: Text('Hesabu cash halisi iliyopo mkononi, kisha angalia salio halisi la kila laini (*150*00# n.k.) '
                  'na uandike hapa. Mfumo utalinganisha na hesabu zake.'),
            ),
          ),
          const SizedBox(height: 12),
          MoneyField(controller: _cash, label: 'Cash halisi uliyohesabu'),
          const SizedBox(height: 16),
          const Text('Float halisi kwenye laini', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          for (final e in _floats.entries) ...[
            MoneyField(controller: e.value, label: networkOf(e.key).label),
            const SizedBox(height: 10),
          ],
          TextFormField(
            controller: _notes,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'Maelezo kwa mmiliki (hiari)'),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _busy ? null : _close,
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            icon: const Icon(Icons.lock),
            label: const Text('Funga siku'),
          ),
        ]),
      ),
    );
  }
}

class CloseResultDialog extends StatelessWidget {
  final Map<String, dynamic> result;
  const CloseResultDialog({super.key, required this.result});
  @override
  Widget build(BuildContext context) {
    final floats = (result['floats'] as List?) ?? [];
    final total = n(result['total_variance']);
    return AlertDialog(
      title: Row(children: [
        Icon(total == 0 ? Icons.check_circle : Icons.warning_amber,
            color: total == 0 ? Naya.green : (total < 0 ? Naya.danger : Naya.gold)),
        const SizedBox(width: 8),
        const Text('Siku imefungwa'),
      ]),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Kamisheni ya leo: ${tzs(result['commission'])}'),
          Text('Miamala: ${result['tx_count']}'),
          const Divider(),
          Row(children: [const Expanded(child: Text('Cash')), VarianceText(result['cash_variance'])]),
          for (final f in floats)
            Row(children: [Expanded(child: Text(f['label'].toString())), VarianceText(f['variance'])]),
          const Divider(),
          Row(children: [
            const Expanded(child: Text('JUMLA', style: TextStyle(fontWeight: FontWeight.bold))),
            VarianceText(total, fontSize: 16),
          ]),
        ]),
      ),
      actions: [FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Sawa'))],
    );
  }
}

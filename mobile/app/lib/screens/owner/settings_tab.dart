import 'package:flutter/material.dart';

import '../../config.dart';
import '../../services/api.dart';
import '../../services/format.dart';
import '../../widgets/common.dart';
import '../shared/customers_screen.dart';
import 'audit_screen.dart';
import '../../theme.dart';

class SettingsTab extends StatelessWidget {
  final Map<String, dynamic> profile;
  const SettingsTab({super.key, required this.profile});

  @override
  Widget build(BuildContext context) {
    void go(Widget w) => Navigator.push(context, MaterialPageRoute(builder: (_) => w));
    final businessId = profile['business_id'].toString();
    return Scaffold(
      appBar: AppBar(title: const Text('Mipangilio')),
      body: ListView(children: [
        ListTile(
          leading: const CircleAvatar(child: Icon(Icons.person)),
          title: Text(profile['full_name']?.toString() ?? ''),
          subtitle: Text('${profile['email'] ?? ''}  •  Mmiliki'),
        ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.storefront),
          title: const Text('Vibanda'),
          subtitle: const Text('Ongeza vibanda na laini za mitandao'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => go(OutletsScreen(businessId: businessId)),
        ),
        ListTile(
          leading: const Icon(Icons.badge_outlined),
          title: const Text('Mawakala'),
          subtitle: const Text('Ongeza mfanyakazi, mpangie kibanda, zima akaunti'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => go(const AgentsScreen()),
        ),
        ListTile(
          leading: const Icon(Icons.people_alt_outlined),
          title: const Text('Wateja'),
          subtitle: const Text('Daftari la wateja na miamala yao'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => go(const CustomersScreen()),
        ),
        ListTile(
          leading: const Icon(Icons.history_edu_outlined),
          title: const Text('Kumbukumbu (audit log)'),
          subtitle: const Text('Kila kitendo: nani, nini, saa ngapi'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => go(const AuditScreen()),
        ),
        ListTile(
          leading: const Icon(Icons.percent),
          title: const Text('Viwango vya kamisheni'),
          subtitle: const Text('Kamisheni inahesabiwa yenyewe kwa kila muamala'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => go(TiersScreen(businessId: businessId)),
        ),
        ListTile(
          leading: const Icon(Icons.notifications_active_outlined),
          title: Text(AppConfig.smsEnabled ? 'Biashara na tahadhari za SMS' : 'Biashara na tahadhari'),
          subtitle: const Text('Kiwango cha float ndogo, miamala mikubwa, ripoti ya siku'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => go(const BusinessSettingsScreen()),
        ),
        ListTile(
          leading: const Icon(Icons.workspace_premium_outlined),
          title: const Text('Usajili na malipo'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => go(SubscriptionScreen(phone: profile['phone']?.toString() ?? '')),
        ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.logout, color: Naya.danger),
          title: const Text('Toka', style: TextStyle(color: Naya.danger)),
          onTap: () async {
            if (await confirm(context, 'Toka', 'Unataka kutoka kwenye akaunti?')) await Api.signOut();
          },
        ),
        const Padding(
          padding: EdgeInsets.all(16),
          child: Text('${AppConfig.appName} v1.2 • ${AppConfig.company}',
              textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: Naya.offline)),
        ),
      ]),
    );
  }
}

// =====================================================================
// VIBANDA
// =====================================================================
class OutletsScreen extends StatefulWidget {
  final String businessId;
  const OutletsScreen({super.key, required this.businessId});
  @override
  State<OutletsScreen> createState() => _OutletsScreenState();
}

class _OutletsScreenState extends State<OutletsScreen> {
  List<Map<String, dynamic>> _items = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.outlets();
      if (mounted) setState(() => _items = r);
    } catch (e) {
      if (mounted) showMsg(context, errorText(e), error: true);
    }
  }

  Future<void> _edit([Map<String, dynamic>? o]) async {
    final ok = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => OutletForm(businessId: widget.businessId, outlet: o)),
    );
    if (ok == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Vibanda')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _edit(),
        icon: const Icon(Icons.add),
        label: const Text('Kibanda kipya'),
      ),
      body: _items.isEmpty
          ? const EmptyState(icon: Icons.storefront, text: 'Bado huna kibanda')
          : ListView(children: [
              for (final o in _items)
                ListTile(
                  leading: Icon(Icons.storefront, color: o['active'] == true ? null : Naya.offline),
                  title: Text(o['name'].toString()),
                  subtitle: Text([o['location'] ?? '', if (o['active'] != true) 'IMEZIMWA'].join(' ')),
                  trailing: const Icon(Icons.edit),
                  onTap: () => _edit(o),
                ),
            ]),
    );
  }
}

class OutletForm extends StatefulWidget {
  final String businessId;
  final Map<String, dynamic>? outlet;
  const OutletForm({super.key, required this.businessId, this.outlet});
  @override
  State<OutletForm> createState() => _OutletFormState();
}

class _OutletFormState extends State<OutletForm> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.outlet?['name']?.toString());
  late final _loc = TextEditingController(text: widget.outlet?['location']?.toString());
  late bool _active = widget.outlet?['active'] != false;
  final Map<String, bool> _enabled = {for (final x in networks) x.code: true};
  final Map<String, TextEditingController> _numbers = {for (final x in networks) x.code: TextEditingController()};
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final id = widget.outlet?['id']?.toString();
    if (id != null) {
      Api.outletLines(id).then((lines) {
        if (!mounted || lines.isEmpty) return;
        setState(() {
          for (final k in _enabled.keys) {
            _enabled[k] = false;
          }
          for (final l in lines) {
            _enabled[l['network']] = true;
            _numbers[l['network']]?.text = l['agent_number']?.toString() ?? '';
          }
        });
      });
    }
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (!_enabled.values.any((v) => v)) {
      showMsg(context, 'Chagua angalau mtandao mmoja', error: true);
      return;
    }
    setState(() => _busy = true);
    final ok = await runTask(context, () async {
      final id = await Api.saveOutlet(
        id: widget.outlet?['id']?.toString(),
        businessId: widget.businessId,
        name: _name.text.trim(),
        location: _loc.text.trim(),
        active: _active,
      );
      await Api.saveLines(widget.businessId, id, {
        for (final e in _enabled.entries.where((e) => e.value)) e.key: _numbers[e.key]!.text.trim(),
      });
    }, success: 'Kibanda kimehifadhiwa');
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.outlet == null ? 'Kibanda kipya' : 'Hariri kibanda')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          TextFormField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Jina la kibanda', hintText: 'mf. Kibanda Sokoni'),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Lazima' : null,
          ),
          const SizedBox(height: 12),
          TextFormField(controller: _loc, decoration: const InputDecoration(labelText: 'Mahali (hiari)')),
          if (widget.outlet != null)
            SwitchListTile(
              title: const Text('Kibanda kinafanya kazi'),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
          const SizedBox(height: 16),
          const Text('Mitandao inayotumika kibandani', style: TextStyle(fontWeight: FontWeight.w700)),
          for (final x in networks) ...[
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(x.label),
              value: _enabled[x.code],
              onChanged: (v) => setState(() => _enabled[x.code] = v ?? false),
            ),
            if (_enabled[x.code] == true)
              TextFormField(
                controller: _numbers[x.code],
                decoration: InputDecoration(labelText: 'Namba ya wakala ${x.label} (hiari)', isDense: true),
              ),
          ],
          const SizedBox(height: 20),
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

// =====================================================================
// MAWAKALA
// =====================================================================
class AgentsScreen extends StatefulWidget {
  const AgentsScreen({super.key});
  @override
  State<AgentsScreen> createState() => _AgentsScreenState();
}

class _AgentsScreenState extends State<AgentsScreen> {
  List<Map<String, dynamic>> _agents = [];
  List<Map<String, dynamic>> _outlets = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([Api.agents(), Api.outlets()]);
      if (!mounted) return;
      setState(() {
        _agents = r[0];
        _outlets = r[1];
      });
    } catch (e) {
      if (mounted) showMsg(context, errorText(e), error: true);
    }
  }

  Future<void> _add() async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _AgentForm(outlets: _outlets),
    );
    if (ok == true) _load();
  }

  Future<void> _manage(Map<String, dynamic> a) async {
    await showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(title: Text(a['full_name'].toString()), subtitle: Text(a['email']?.toString() ?? '')),
          const Divider(height: 1),
          for (final o in _outlets)
            ListTile(
              leading: Icon(a['outlet_id'] == o['id'] ? Icons.radio_button_checked : Icons.radio_button_off),
              title: Text('Mpangie: ${o['name']}'),
              onTap: () async {
                Navigator.pop(ctx);
                if (await runTask(context, () => Api.updateAgent(a['id'], {'outlet_id': o['id']}),
                    success: 'Amepangiwa ${o['name']}')) {
                  _load();
                }
              },
            ),
          ListTile(
            leading: Icon(a['active'] == true ? Icons.block : Icons.check_circle,
                color: a['active'] == true ? Naya.danger : Naya.green),
            title: Text(a['active'] == true ? 'Zima akaunti' : 'Washa akaunti'),
            onTap: () async {
              Navigator.pop(ctx);
              if (await runTask(context, () => Api.updateAgent(a['id'], {'active': a['active'] != true}))) _load();
            },
          ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mawakala')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _outlets.isEmpty
            ? () => showMsg(context, 'Ongeza kibanda kwanza', error: true)
            : _add,
        icon: const Icon(Icons.person_add),
        label: const Text('Wakala mpya'),
      ),
      body: _agents.isEmpty
          ? const EmptyState(icon: Icons.badge_outlined, text: 'Bado huna wakala')
          : ListView(children: [
              for (final a in _agents)
                ListTile(
                  leading: CircleAvatar(
                    backgroundColor: a['active'] == true ? null : Naya.line,
                    child: Text(a['full_name'].toString().isEmpty ? '?' : a['full_name'].toString()[0].toUpperCase()),
                  ),
                  title: Text(a['full_name'].toString()),
                  subtitle: Text([
                    (a['outlets'] as Map?)?['name'] ?? 'Hajapangiwa kibanda',
                    a['phone'] ?? '',
                    if (a['active'] != true) 'IMEZIMWA',
                  ].join(' • ')),
                  trailing: const Icon(Icons.more_vert),
                  onTap: () => _manage(a),
                ),
            ]),
    );
  }
}

class _AgentForm extends StatefulWidget {
  final List<Map<String, dynamic>> outlets;
  const _AgentForm({required this.outlets});
  @override
  State<_AgentForm> createState() => _AgentFormState();
}

class _AgentFormState extends State<_AgentForm> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _pass = TextEditingController();
  late String? _outlet = widget.outlets.isNotEmpty ? widget.outlets.first['id'].toString() : null;
  bool _busy = false;

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final ok = await runTask(
      context,
      () => Api.createAgent(
        email: _email.text.trim(),
        password: _pass.text,
        fullName: _name.text.trim(),
        phone: _phone.text.trim(),
        outletId: _outlet,
      ),
      success: 'Wakala ameongezwa. Mpe barua pepe na nenosiri.',
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
          const Text('Wakala mpya', style: TextStyle(fontFamily: kDisplayFont, fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          TextFormField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Jina kamili'),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Lazima' : null,
          ),
          const SizedBox(height: 10),
          TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Simu')),
          const SizedBox(height: 10),
          TextFormField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Barua pepe ya kuingia'),
            validator: (v) => (v == null || !v.contains('@')) ? 'Weka barua pepe sahihi' : null,
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _pass,
            decoration: const InputDecoration(labelText: 'Nenosiri (angalau herufi 6)'),
            validator: (v) => (v == null || v.length < 6) ? 'Angalau herufi 6' : null,
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            value: _outlet,
            decoration: const InputDecoration(labelText: 'Kibanda'),
            items: [
              for (final o in widget.outlets)
                DropdownMenuItem(value: o['id'].toString(), child: Text(o['name'].toString())),
            ],
            onChanged: (v) => setState(() => _outlet = v),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            child: const Text('Ongeza wakala'),
          ),
        ]),
      ),
    );
  }
}

// =====================================================================
// KAMISHENI
// =====================================================================
class TiersScreen extends StatefulWidget {
  final String businessId;
  const TiersScreen({super.key, required this.businessId});
  @override
  State<TiersScreen> createState() => _TiersScreenState();
}

class _TiersScreenState extends State<TiersScreen> {
  List<Map<String, dynamic>> _tiers = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final r = await Api.tiers();
    if (mounted) setState(() => _tiers = r);
  }

  Future<void> _add() async {
    final form = GlobalKey<FormState>();
    final min = TextEditingController();
    final max = TextEditingController();
    final comm = TextEditingController();
    String network = 'mpesa';
    String type = 'withdrawal';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setD) => AlertDialog(
          title: const Text('Kiwango kipya'),
          content: Form(
            key: form,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                DropdownButtonFormField<String>(
                  value: network,
                  decoration: const InputDecoration(labelText: 'Mtandao'),
                  items: [for (final x in networks) DropdownMenuItem(value: x.code, child: Text(x.label))],
                  onChanged: (v) => setD(() => network = v!),
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  value: type,
                  decoration: const InputDecoration(labelText: 'Aina'),
                  items: const [
                    DropdownMenuItem(value: 'withdrawal', child: Text('Kutoa')),
                    DropdownMenuItem(value: 'deposit', child: Text('Kuweka')),
                  ],
                  onChanged: (v) => setD(() => type = v!),
                ),
                const SizedBox(height: 8),
                MoneyField(controller: min, label: 'Kuanzia'),
                const SizedBox(height: 8),
                MoneyField(controller: max, label: 'Hadi'),
                const SizedBox(height: 8),
                MoneyField(controller: comm, label: 'Kamisheni'),
              ]),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Ghairi')),
            FilledButton(
              onPressed: () {
                if (form.currentState!.validate()) Navigator.pop(ctx, true);
              },
              child: const Text('Hifadhi'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    if (parseAmount(max.text) < parseAmount(min.text)) {
      showMsg(context, '"Hadi" lazima iwe kubwa kuliko "Kuanzia"', error: true);
      return;
    }
    if (await runTask(
        context,
        () => Api.addTier({
              'business_id': widget.businessId,
              'network': network,
              'tx_type': type,
              'min_amount': parseAmount(min.text),
              'max_amount': parseAmount(max.text),
              'commission': parseAmount(comm.text),
            }))) {
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final t in _tiers) {
      grouped.putIfAbsent('${t['network']}|${t['tx_type']}', () => []).add(t);
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Viwango vya kamisheni')),
      floatingActionButton: FloatingActionButton(onPressed: _add, child: const Icon(Icons.add)),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        const Card(
          color: Naya.mint,
          child: Padding(
            padding: EdgeInsets.all(12),
            child: Text('Weka viwango kama vilivyo kwenye jedwali la kamisheni la kila mtandao. '
                'Mfano: M-Pesa, Kutoa, 1,000 - 3,000 = 150. Wakala akiacha kamisheni wazi, mfumo utaihesabu kutokana na hapa.'),
          ),
        ),
        if (_tiers.isEmpty) const EmptyState(icon: Icons.percent, text: 'Bado hakuna viwango'),
        for (final g in grouped.entries) ...[
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 4),
            child: Row(children: [
              NetworkChip(g.key.split('|')[0]),
              const SizedBox(width: 8),
              Text(g.key.split('|')[1] == 'deposit' ? 'Kuweka' : 'Kutoa',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
            ]),
          ),
          for (final t in g.value)
            ListTile(
              dense: true,
              title: Text('${plain(t['min_amount'])} - ${plain(t['max_amount'])}'),
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                Text(tzs(t['commission']), style: const TextStyle(fontWeight: FontWeight.bold)),
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    if (await runTask(context, () => Api.deleteTier(t['id']))) _load();
                  },
                ),
              ]),
            ),
        ],
        const SizedBox(height: 80),
      ]),
    );
  }
}

// =====================================================================
// BIASHARA NA TAHADHARI
// =====================================================================
class BusinessSettingsScreen extends StatefulWidget {
  const BusinessSettingsScreen({super.key});
  @override
  State<BusinessSettingsScreen> createState() => _BusinessSettingsScreenState();
}

class _BusinessSettingsScreenState extends State<BusinessSettingsScreen> {
  final _form = GlobalKey<FormState>();
  Map<String, dynamic>? _b;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _lowFloat = TextEditingController();
  final _lowCash = TextEditingController();
  final _largeTx = TextEditingController();
  final _variance = TextEditingController();
  bool _daily = true;
  bool _alerts = true;

  @override
  void initState() {
    super.initState();
    Api.myBusiness().then((b) {
      if (!mounted || b == null) return;
      setState(() {
        _b = b;
        _name.text = b['name'] ?? '';
        _phone.text = b['owner_phone'] ?? '';
        _lowFloat.text = plain(b['low_float_threshold']);
        _lowCash.text = plain(b['low_cash_threshold']);
        _largeTx.text = plain(b['large_tx_threshold']);
        _variance.text = plain(b['variance_alert_threshold']);
        _daily = b['sms_daily_report'] == true;
        _alerts = b['sms_alerts'] == true;
      });
    });
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    await runTask(
      context,
      () => Api.updateBusiness(_b!['id'], {
        'name': _name.text.trim(),
        'owner_phone': _phone.text.trim(),
        'low_float_threshold': parseAmount(_lowFloat.text),
        'low_cash_threshold': parseAmount(_lowCash.text),
        'large_tx_threshold': parseAmount(_largeTx.text),
        'variance_alert_threshold': parseAmount(_variance.text),
        if (AppConfig.smsEnabled) 'sms_daily_report': _daily,
        if (AppConfig.smsEnabled) 'sms_alerts': _alerts,
      }),
      success: 'Imehifadhiwa',
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Biashara na tahadhari')),
      body: _b == null
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _form,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                TextFormField(controller: _name, decoration: const InputDecoration(labelText: 'Jina la biashara')),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: AppConfig.smsEnabled ? 'Simu ya kupokea SMS' : 'Simu ya mmiliki'),
                ),
                const SizedBox(height: 20),
                const Text('Nitumie tahadhari pale:', style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 10),
                MoneyField(controller: _lowFloat, label: 'Float ya mtandao ikishuka chini ya'),
                const SizedBox(height: 10),
                MoneyField(controller: _lowCash, label: 'Cash ya kibanda ikishuka chini ya'),
                const SizedBox(height: 10),
                MoneyField(controller: _largeTx, label: 'Muamala mmoja ukifika au kuzidi'),
                const SizedBox(height: 10),
                MoneyField(controller: _variance, label: 'Upungufu/ziada wakati wa kufunga ukifika'),
                if (!AppConfig.smsEnabled)
                  const Padding(
                    padding: EdgeInsets.only(top: 12),
                    child: Text('Tahadhari zinaonekana kwenye Arifa ndani ya app. SMS zitaongezwa hivi karibuni.',
                        style: TextStyle(color: Naya.muted)),
                  ),
                if (AppConfig.smsEnabled) SwitchListTile(
                  title: const Text('Tuma tahadhari kwa SMS'),
                  value: _alerts,
                  onChanged: (v) => setState(() => _alerts = v),
                ),
                if (AppConfig.smsEnabled) SwitchListTile(
                  title: const Text('Ripoti ya siku kwa SMS (saa 3 usiku)'),
                  value: _daily,
                  onChanged: (v) => setState(() => _daily = v),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _save,
                  style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                  child: const Text('Hifadhi'),
                ),
              ]),
            ),
    );
  }
}

// =====================================================================
// USAJILI (Snippe)
// =====================================================================
class SubscriptionScreen extends StatefulWidget {
  final String phone;
  const SubscriptionScreen({super.key, required this.phone});
  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> {
  Map<String, dynamic>? _b;
  List<Map<String, dynamic>> _plans = [];
  String? _plan;
  int _months = 1;
  late final _phone = TextEditingController(text: widget.phone);
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final r = await Future.wait([Api.myBusiness(), Api.plans()]);
    if (!mounted) return;
    setState(() {
      _b = r[0] as Map<String, dynamic>?;
      _plans = r[1] as List<Map<String, dynamic>>;
      _plan ??= _b?['plan']?.toString();
    });
  }

  Future<void> _pay() async {
    if (_plan == null) return;
    setState(() => _busy = true);
    String? msg;
    final ok = await runTask(context, () async {
      msg = await Api.subscribe(_plan!, _months, _phone.text.trim());
    });
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      await showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Thibitisha kwenye simu'),
          content: Text('${msg ?? ''}\n\nBaada ya kulipa, bonyeza "Nimelipa" kuangalia hali.'),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Nimelipa'))],
        ),
      );
      await Future.delayed(const Duration(seconds: 3));
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final until = DateTime.tryParse(_b?['subscription_until']?.toString() ?? '');
    final active = until != null && until.isAfter(DateTime.now());
    Map<String, dynamic>? selected;
    for (final p in _plans) {
      if (p['code'] == _plan) selected = p;
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Usajili na malipo')),
      body: _b == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.all(16), children: [
              Card(
                color: active ? Naya.mint : Naya.dangerBg,
                child: ListTile(
                  leading: Icon(active ? Icons.verified : Icons.error_outline, color: active ? Naya.green : Naya.danger),
                  title: Text('Mpango: ${(_b!['plans'] as Map?)?['name'] ?? _b!['plan']}'),
                  subtitle: Text(active
                      ? 'Upo hai hadi ${niceDate(until.toLocal())}'
                      : 'Usajili umeisha${until != null ? ' tarehe ${niceDate(until.toLocal())}' : ''}'),
                ),
              ),
              const SizedBox(height: 16),
              const Text('Chagua mpango', style: TextStyle(fontWeight: FontWeight.w700)),
              for (final p in _plans)
                RadioListTile<String>(
                  value: p['code'].toString(),
                  groupValue: _plan,
                  onChanged: (v) => setState(() => _plan = v),
                  title: Text(p['name'].toString()),
                  subtitle: Text(AppConfig.smsEnabled ? '${tzs(p['price_tzs'])} / mwezi • SMS ${p['sms_per_month']}' : '${tzs(p['price_tzs'])} / mwezi'),
                ),
              const SizedBox(height: 8),
              DropdownButtonFormField<int>(
                value: _months,
                decoration: const InputDecoration(labelText: 'Muda'),
                items: const [
                  DropdownMenuItem(value: 1, child: Text('Mwezi 1')),
                  DropdownMenuItem(value: 3, child: Text('Miezi 3')),
                  DropdownMenuItem(value: 6, child: Text('Miezi 6')),
                  DropdownMenuItem(value: 12, child: Text('Mwaka 1')),
                ],
                onChanged: (v) => setState(() => _months = v ?? 1),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Namba ya kulipia (M-Pesa, Mixx, Airtel, Halopesa)'),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _busy || selected == null ? null : _pay,
                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                icon: const Icon(Icons.phone_android),
                label: Text(selected == null ? 'Chagua mpango' : 'Lipa ${tzs(n(selected!['price_tzs']) * _months)}'),
              ),
            ]),
    );
  }
}

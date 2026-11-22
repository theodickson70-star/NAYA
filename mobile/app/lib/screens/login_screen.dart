import 'package:flutter/material.dart';

import '../config.dart';
import '../services/api.dart';
import '../services/format.dart';
import '../theme.dart';
import '../widgets/common.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _pass = TextEditingController();
  bool _register = false;
  bool _busy = false;
  bool _hide = true;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    await runTask(context, () async {
      final email = _email.text.trim().toLowerCase();
      if (_register) {
        final r = await sb.auth.signUp(email: email, password: _pass.text);
        if (r.session == null && mounted) {
          showMsg(context, 'Akaunti imeundwa. Thibitisha barua pepe kisha uingie.');
          setState(() => _register = false);
        }
      } else {
        await sb.auth.signInWithPassword(email: email, password: _pass.text);
        await Api.logEvent('login');
      }
    });
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SingleChildScrollView(
        child: Column(children: [
          // Kichwa cha kijani: alama + ujumbe
          Container(
            width: double.infinity,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Naya.greenDark, Naya.greenDeep],
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 64),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const BrandMark(size: 44, onDark: true, showTagline: true),
                      const SizedBox(height: 28),
                      Text('Simamia uwakala wako\npopote ulipo.', style: display(28, color: Colors.white)),
                      const SizedBox(height: 10),
                      Text('Cash, float ya kila mtandao, kamisheni na upungufu — vyote kwa wakati halisi.',
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 15)),
                      const SizedBox(height: 16),
                      Wrap(spacing: 6, runSpacing: 6, children: [
                        for (final net in networks)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.10),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Row(mainAxisSize: MainAxisSize.min, children: [
                              CircleAvatar(radius: 4, backgroundColor: net.color),
                              const SizedBox(width: 6),
                              Text(net.label, style: const TextStyle(color: Colors.white, fontSize: 12)),
                            ]),
                          ),
                      ]),
                    ]),
                  ),
                ),
              ),
            ),
          ),
          // Fomu (inapanda juu ya kichwa kidogo)
          Transform.translate(
            offset: const Offset(0, -40),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 22, 20, 12),
                      child: Form(
                        key: _form,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Text(_register ? 'Sajili biashara yako' : 'Karibu tena', style: display(22)),
                          const SizedBox(height: 4),
                          Text(
                            _register
                                ? 'Kwa mmiliki wa vibanda. Siku 14 za kwanza ni bure.'
                                : 'Ingia kwa barua pepe na nenosiri lako.',
                            style: const TextStyle(color: Naya.muted),
                          ),
                          const SizedBox(height: 18),
                          TextFormField(
                            controller: _email,
                            keyboardType: TextInputType.emailAddress,
                            decoration: const InputDecoration(labelText: 'Barua pepe', prefixIcon: Icon(Icons.email_outlined)),
                            validator: (v) => (v == null || !v.contains('@')) ? 'Weka barua pepe sahihi' : null,
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _pass,
                            obscureText: _hide,
                            decoration: InputDecoration(
                              labelText: 'Nenosiri',
                              prefixIcon: const Icon(Icons.lock_outline),
                              suffixIcon: IconButton(
                                icon: Icon(_hide ? Icons.visibility : Icons.visibility_off),
                                onPressed: () => setState(() => _hide = !_hide),
                              ),
                            ),
                            validator: (v) => (v == null || v.length < 6) ? 'Angalau herufi 6' : null,
                            onFieldSubmitted: (_) => _submit(),
                          ),
                          const SizedBox(height: 18),
                          FilledButton(
                            onPressed: _busy ? null : _submit,
                            child: _busy
                                ? const SizedBox(
                                    height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                : Text(_register ? 'Sajili biashara' : 'Ingia'),
                          ),
                          const SizedBox(height: 6),
                          TextButton(
                            onPressed: () => setState(() => _register = !_register),
                            child: Text(_register ? 'Una akaunti tayari? Ingia' : 'Wewe ni mmiliki mpya? Sajili biashara'),
                          ),
                          if (!_register)
                            Container(
                              margin: const EdgeInsets.only(top: 6, bottom: 8),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(color: Naya.goldSoft, borderRadius: BorderRadius.circular(12)),
                              child: const Row(children: [
                                Icon(Icons.info_outline, size: 18, color: Naya.goldInk),
                                SizedBox(width: 8),
                                Expanded(
                                  child: Text('Wakala: tumia barua pepe na nenosiri ulilopewa na mmiliki wako.',
                                      style: TextStyle(fontSize: 13, color: Naya.goldInk)),
                                ),
                              ]),
                            ),
                        ]),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          const Text(AppConfig.company, textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: Naya.offline)),
          const SizedBox(height: 24),
        ]),
      ),
    );
  }
}

/// Baada ya kujisajili: jina la biashara, jina na simu ya mmiliki
class CompleteRegistrationScreen extends StatefulWidget {
  final VoidCallback onDone;
  const CompleteRegistrationScreen({super.key, required this.onDone});
  @override
  State<CompleteRegistrationScreen> createState() => _CompleteRegistrationScreenState();
}

class _CompleteRegistrationScreenState extends State<CompleteRegistrationScreen> {
  final _form = GlobalKey<FormState>();
  final _biz = TextEditingController();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  bool _busy = false;

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final ok = await runTask(context, () => Api.registerBusiness(_biz.text.trim(), _name.text.trim(), _phone.text.trim()));
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) widget.onDone();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Kamilisha usajili'), actions: [
        TextButton(onPressed: Api.signOut, child: const Text('Toka')),
      ]),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Form(
              key: _form,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Text('Karibu! Jaza taarifa za biashara yako. Utapata siku 14 za majaribio bure.'),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _biz,
                  decoration: const InputDecoration(labelText: 'Jina la biashara', hintText: 'mf. Juma Wakala Services'),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Lazima' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _name,
                  decoration: const InputDecoration(labelText: 'Jina lako kamili'),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Lazima' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                      labelText: 'Namba ya simu', hintText: '07XXXXXXXX'),
                  validator: (v) => (v == null || v.replaceAll(RegExp(r'\D'), '').length < 9) ? 'Weka namba sahihi' : null,
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _save,
                  style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                  child: const Text('Anza kutumia'),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

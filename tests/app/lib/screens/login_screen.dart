import 'package:flutter/material.dart';

import '../config.dart';
import '../services/api.dart';
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
      }
    });
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Icon(Icons.account_balance_wallet_rounded, size: 64, color: cs.primary),
                  const SizedBox(height: 8),
                  Text(AppConfig.appName,
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: cs.primary)),
                  const Text('Simamia uwakala wako popote ulipo',
                      textAlign: TextAlign.center, style: TextStyle(color: Colors.black54)),
                  const SizedBox(height: 32),
                  Text(_register ? 'Sajili biashara mpya (Mmiliki)' : 'Ingia',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 12),
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
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                    child: _busy
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(_register ? 'Jisajili' : 'Ingia'),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: () => setState(() => _register = !_register),
                    child: Text(_register ? 'Una akaunti tayari? Ingia' : 'Wewe ni mmiliki mpya? Sajili biashara'),
                  ),
                  if (!_register)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text('Mawakala: tumia barua pepe na nenosiri ulilopewa na mmiliki.',
                          textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Colors.black54)),
                    ),
                  const SizedBox(height: 24),
                  const Text(AppConfig.company,
                      textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: Colors.black38)),
                ]),
              ),
            ),
          ),
        ),
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
        TextButton(onPressed: () => sb.auth.signOut(), child: const Text('Toka')),
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

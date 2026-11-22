import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../services/api.dart';
import '../services/format.dart';

void showMsg(BuildContext context, String msg, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? Colors.red.shade700 : Colors.green.shade700,
      behavior: SnackBarBehavior.floating,
    ));
}

/// Endesha kazi, onyesha kosa kama ipo. Inarudisha true ikifanikiwa.
Future<bool> runTask(BuildContext context, Future<void> Function() task, {String? success}) async {
  try {
    await task();
    if (success != null && context.mounted) showMsg(context, success);
    return true;
  } catch (e) {
    if (context.mounted) showMsg(context, errorText(e), error: true);
    return false;
  }
}

/// Inaweka koma kwenye kiasi wakati wa kuandika: 1250000 -> 1,250,000
class ThousandsFormatter extends TextInputFormatter {
  final _f = NumberFormat('#,##0', 'en_US');
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final digits = newValue.text.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.isEmpty) return const TextEditingValue(text: '');
    final text = _f.format(int.parse(digits));
    return TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
  }
}

class MoneyField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final bool autofocus;
  final bool required;
  final bool allowNegative;
  const MoneyField({
    super.key,
    required this.controller,
    required this.label,
    this.autofocus = false,
    this.required = true,
    this.allowNegative = false,
  });

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      autofocus: autofocus,
      keyboardType: TextInputType.number,
      inputFormatters: [ThousandsFormatter()],
      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
      decoration: InputDecoration(labelText: label, prefixText: 'TSh ', border: const OutlineInputBorder()),
      validator: (v) {
        if (!required) return null;
        if (v == null || v.trim().isEmpty) return 'Weka kiasi';
        return null;
      },
    );
  }
}

class StatCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color? color;
  final String? subtitle;
  const StatCard({super.key, required this.title, required this.value, required this.icon, this.color, this.subtitle});

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.primary;
    return Card(
      elevation: 0,
      color: c.withValues(alpha: 0.08),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(icon, size: 18, color: c),
            const SizedBox(width: 6),
            Expanded(child: Text(title, style: TextStyle(color: c, fontWeight: FontWeight.w600, fontSize: 12))),
          ]),
          const SizedBox(height: 6),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          ),
          if (subtitle != null) Text(subtitle!, style: const TextStyle(fontSize: 11, color: Colors.black54)),
        ]),
      ),
    );
  }
}

class NetworkChip extends StatelessWidget {
  final String code;
  const NetworkChip(this.code, {super.key});
  @override
  Widget build(BuildContext context) {
    final net = networkOf(code);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: net.color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(net.label, style: TextStyle(color: net.color, fontSize: 11, fontWeight: FontWeight.w700)),
    );
  }
}

/// Mstari wa salio: jina — kiasi (nyekundu kama hasi au chini ya kiwango)
class BalanceRow extends StatelessWidget {
  final String label;
  final dynamic amount;
  final Color? dot;
  final double? warnBelow;
  const BalanceRow({super.key, required this.label, required this.amount, this.dot, this.warnBelow});
  @override
  Widget build(BuildContext context) {
    final v = n(amount);
    final warn = v < 0 || (warnBelow != null && v < warnBelow!);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(children: [
        if (dot != null) ...[
          CircleAvatar(radius: 5, backgroundColor: dot),
          const SizedBox(width: 8),
        ],
        Expanded(child: Text(label)),
        Text(tzs(v), style: TextStyle(fontWeight: FontWeight.bold, color: warn ? Colors.red.shade700 : null)),
      ]),
    );
  }
}

class VarianceText extends StatelessWidget {
  final dynamic value;
  final double fontSize;
  const VarianceText(this.value, {super.key, this.fontSize = 14});
  @override
  Widget build(BuildContext context) {
    final v = n(value);
    final color = v == 0 ? Colors.green.shade700 : (v < 0 ? Colors.red.shade700 : Colors.orange.shade800);
    final label = v == 0 ? 'Sawa' : (v < 0 ? 'Upungufu ${tzs(v.abs())}' : 'Ziada ${tzs(v)}');
    return Text(label, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: fontSize));
  }
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String text;
  const EmptyState({super.key, required this.icon, required this.text});
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 56, color: Colors.black26),
            const SizedBox(height: 12),
            Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.black54)),
          ]),
        ),
      );
}

Future<String?> askText(BuildContext context, String title, {String hint = ''}) async {
  final c = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: TextField(controller: c, autofocus: true, decoration: InputDecoration(hintText: hint)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Ghairi')),
        FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('Sawa')),
      ],
    ),
  );
}

Future<bool> confirm(BuildContext context, String title, String body) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Hapana')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Ndiyo')),
      ],
    ),
  );
  return r ?? false;
}

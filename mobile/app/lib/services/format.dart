import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

final _money = NumberFormat('#,##0', 'en_US');

/// Badilisha thamani yoyote (int/double/String/null) kuwa double
double n(dynamic v) {
  if (v == null) return 0;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString()) ?? 0;
}

String tzs(dynamic v) => 'TSh ${_money.format(n(v))}';
String plain(dynamic v) => _money.format(n(v));

/// Soma kiasi kilichoandikwa "1,250,000" -> 1250000
double parseAmount(String s) => double.tryParse(s.replaceAll(RegExp(r'[^0-9.\-]'), '')) ?? 0;

String dateTime(dynamic iso) {
  if (iso == null) return '-';
  final d = DateTime.tryParse(iso.toString())?.toLocal();
  return d == null ? '-' : DateFormat('dd/MM HH:mm').format(d);
}

String timeOnly(dynamic iso) {
  if (iso == null) return '-';
  final d = DateTime.tryParse(iso.toString())?.toLocal();
  return d == null ? '-' : DateFormat('HH:mm').format(d);
}

String ymd(DateTime d) => DateFormat('yyyy-MM-dd').format(d);
String niceDate(DateTime d) => DateFormat('dd MMM yyyy').format(d);

class Network {
  final String code;
  final String label;
  final Color color;
  const Network(this.code, this.label, this.color);
}

const networks = <Network>[
  Network('mpesa', 'M-Pesa', Color(0xFFE60000)),
  Network('mixx', 'Mixx by Yas', Color(0xFF0033A0)),
  Network('airtel', 'Airtel Money', Color(0xFFB71C1C)),
  Network('halopesa', 'HaloPesa', Color(0xFFF57C00)),
  Network('tpesa', 'T-Pesa', Color(0xFF00838F)),
];

Network networkOf(String? code) =>
    networks.firstWhere((x) => x.code == code, orElse: () => Network(code ?? '-', code ?? '-', Colors.grey));

const adjustmentKinds = <String, String>{
  'cash_in': 'Mtaji wa cash umeingia',
  'cash_out': 'Cash imepelekwa kwa mmiliki/benki',
  'buy_float': 'Nimenunua float (cash → float)',
  'sell_float': 'Nimeuza float (float → cash)',
  'float_in': 'Float imeingia (imetumwa kwangu)',
  'float_out': 'Float imetoka (nimeituma)',
  'expense': 'Matumizi (chai, umeme n.k.)',
};

bool kindNeedsNetwork(String k) => const {'buy_float', 'sell_float', 'float_in', 'float_out'}.contains(k);

/// 255754123456 -> 0754 123 456
String phoneLocal(dynamic p) {
  final s = (p ?? '').toString().replaceAll(RegExp(r'\D'), '');
  if (s.length == 12 && s.startsWith('255')) {
    final l = '0${s.substring(3)}';
    return '${l.substring(0, 4)} ${l.substring(4, 7)} ${l.substring(7)}';
  }
  return s.isEmpty ? '-' : s;
}

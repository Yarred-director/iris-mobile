import React from 'react';
import { Linking, StyleProp, Text, TextStyle } from 'react-native';

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
};

const TOKEN_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s]+)/g;

function cleanExternalUrl(raw: string) {
  try {
    const url = new URL(raw.replace(/[),.;!?]+$/g, ''));
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function friendlyLabel(label: string) {
  const value = label.trim();
  if (/^(?:https?:\/\/)?(?:www\.)?[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(value)) return 'Otvoriť odkaz ↗';
  return value.endsWith('↗') ? value : `${value} ↗`;
}

export default function RichText({ text, style }: Props) {
  const value = String(text || '');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(value))) {
    if (match.index > lastIndex) parts.push(value.slice(lastIndex, match.index));

    const markdownLabel = match[1];
    const markdownUrl = match[2];
    const boldText = match[3];
    const plainUrl = match[4];

    if (markdownUrl) {
      const href = cleanExternalUrl(markdownUrl);
      parts.push(
        <Text
          key={`link-${key++}`}
          accessibilityRole="link"
          onPress={() => void Linking.openURL(href)}
          style={{ textDecorationLine: 'underline', fontWeight: '700' }}
        >
          {friendlyLabel(markdownLabel)}
        </Text>,
      );
    } else if (boldText) {
      parts.push(<Text key={`bold-${key++}`} style={{ fontWeight: '700' }}>{boldText}</Text>);
    } else if (plainUrl) {
      const href = cleanExternalUrl(plainUrl);
      parts.push(
        <Text
          key={`url-${key++}`}
          accessibilityRole="link"
          onPress={() => void Linking.openURL(href)}
          style={{ textDecorationLine: 'underline', fontWeight: '700' }}
        >
          Otvoriť odkaz ↗
        </Text>,
      );
    }

    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < value.length) parts.push(value.slice(lastIndex));
  return <Text style={style}>{parts}</Text>;
}

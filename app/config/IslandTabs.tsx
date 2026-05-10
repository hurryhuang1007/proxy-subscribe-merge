'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useState } from 'react';

// 与 animal-island-ui 的 Tabs 结构一致，便于沿用其全局样式（layout 已引入 animal-island-ui/style）。
// 库内把 `import png` 直接赋给 <img src>，在 Next 下会变成对象；这里改为 public 下的静态 URL。
const C = {
  tabs: 'animal-tabs-I3QAo',
  tabList: 'animal-tabList--fYUP',
  tabItem: 'animal-tabItem-Ehph4',
  active: 'animal-active-AoX4Y',
  tabIcon: 'animal-tabIcon-Aiu-T',
  tabLabel: 'animal-tabLabel-bCauA',
  tabLeaf: 'animal-tabLeaf-1ud9k',
  tabLeafStatic: 'animal-tabLeafStatic-52CX9',
  tabContent: 'animal-tabContent-zDlRq',
  tabContentInner: 'animal-tabContentInner-Y5kRC',
} as const;

const DEFAULT_LEAF_SRC = '/tab-leaf.png';

export type IslandTabItem = {
  key: string;
  label: ReactNode;
  children: ReactNode;
};

export type IslandTabsProps = {
  items: IslandTabItem[];
  defaultActiveKey?: string;
  activeKey?: string;
  onChange?: (key: string) => void;
  className?: string;
  style?: CSSProperties;
  /** 与原库 Tabs 一致：false 时叶子使用静止样式类 */
  leafAnimation?: boolean;
  /** 激活态小叶子图；库本身不支持该 prop，这里补一层可替换 */
  leafSrc?: string;
};

export function IslandTabs({
  items,
  defaultActiveKey,
  activeKey,
  onChange,
  className,
  style,
  leafAnimation = true,
  leafSrc = DEFAULT_LEAF_SRC,
}: IslandTabsProps) {
  const [innerKey, setInnerKey] = useState(defaultActiveKey ?? items[0]?.key ?? '');
  const resolved = activeKey !== undefined ? activeKey : innerKey;

  const select = useCallback(
    (key: string) => {
      if (activeKey === undefined) setInnerKey(key);
      onChange?.(key);
    },
    [activeKey, onChange],
  );

  const active = items.find((p) => p.key === resolved);
  const rootClass = [C.tabs, className].filter(Boolean).join(' ');

  return (
    <div className={rootClass} style={style}>
      <div className={C.tabList}>
        {items.map((p) => {
          const on = p.key === resolved;
          return (
            <button key={p.key} type="button" className={`${C.tabItem} ${on ? C.active : ''}`} onClick={() => select(p.key)}>
              <span className={C.tabIcon}>{on ? '●' : '○'}</span>
              <span className={C.tabLabel}>{p.label}</span>
              {on ? (
                <img
                  src={leafSrc}
                  alt=""
                  className={[C.tabLeaf, leafAnimation ? null : C.tabLeafStatic].filter(Boolean).join(' ')}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className={C.tabContent}>
        <div className={C.tabContentInner}>{active?.children}</div>
      </div>
    </div>
  );
}

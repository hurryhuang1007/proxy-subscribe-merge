'use client';

import { ThemeToggle } from '@/app/components/ThemeToggle';
import '@/app/config/admin-animal-modal.css';
import { IslandTabs } from '@/app/config/IslandTabs';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Button,
  Card,
  Cursor,
  Divider,
  Footer,
  Input,
  Modal,
  Switch,
} from 'animal-island-ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';

type PoolRecord = Record<string, { url: string; disabled: boolean; userAgent: string }>;
type ProfileRow = { token: string; sources: string[]; name?: string };

type ApiConfig = {
  subscriptionPool: PoolRecord;
  profiles: ProfileRow[];
  adminPasswordConfigured: boolean;
};

function sortedPoolKeys(pool: PoolRecord): string[] {
  return Object.keys(pool).sort((a, b) => a.localeCompare(b));
}

function orderedSourcesForSave(order: string[], poolKeys: string[]) {
  const allowed = new Set(poolKeys);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of order) {
    const k = String(raw).trim();
    if (!k || !allowed.has(k) || seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** 与 animal-island Switch 胶囊形态一致（库内 small 按钮默认圆角偏小） */
const poolRowPillButtonStyle = { borderRadius: 9999 } as const;

/** 弹窗内小号虚线胶囊按钮（Input suffix「随机8位」、排序行「移除」等共用） */
const inputSuffixCompactButtonStyle: CSSProperties = {
  ...poolRowPillButtonStyle,
  height: 26,
  minHeight: 26,
  padding: '0 9px',
  fontSize: 11,
  lineHeight: 1,
  fontWeight: 600,
};

/** 弹窗内表单标签：略小于默认，减轻「字太大」观感 */
const modalFormLabelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontWeight: 600,
  fontSize: 13,
  lineHeight: 1.35,
  color: 'var(--admin-label-color)',
};

const modalFormSectionStyle: CSSProperties = { marginTop: 18 };

const TOKEN_RANDOM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomProfileToken8(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += TOKEN_RANDOM_CHARS[buf[i]! % TOKEN_RANDOM_CHARS.length];
  }
  return s;
}

function SortableProfileSourceRow({ id, onRemove }: { id: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const rowStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.92 : 1,
    zIndex: isDragging ? 2 : undefined,
    boxShadow: isDragging ? '0 8px 20px rgba(0, 0, 0, 0.1)' : undefined,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 8px',
    borderRadius: 10,
    border: '1px dashed var(--admin-sort-row-border)',
    background: 'var(--admin-sort-row-bg)',
  };
  const dragZoneStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
    cursor: 'grab',
    touchAction: 'none',
    borderRadius: 8,
    padding: '2px 2px 2px 0',
  };
  return (
    <div ref={setNodeRef} style={rowStyle}>
      <div {...attributes} {...listeners} style={dragZoneStyle} title="拖动此行排序">
        <span
          aria-hidden
          style={{
            userSelect: 'none',
            opacity: 0.55,
            fontSize: 12,
            lineHeight: 1,
            letterSpacing: -1,
            flexShrink: 0,
          }}
        >
          ⋮⋮
        </span>
        <span
          style={{
            flex: 1,
            fontWeight: 600,
            fontSize: 13,
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            userSelect: 'none',
          }}
        >
          {id}
        </span>
      </div>
      <Button type="dashed" size="small" style={inputSuffixCompactButtonStyle} onClick={onRemove}>
        移除
      </Button>
    </div>
  );
}

function ProfileDraftSourcesSortable({
  sources,
  setSources,
}: {
  sources: string[];
  setSources: Dispatch<SetStateAction<string[]>>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    setSources((items) => {
      const oldIndex = items.indexOf(String(active.id));
      const newIndex = items.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) {
        return items;
      }
      return arrayMove(items, oldIndex, newIndex);
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sources} strategy={verticalListSortingStrategy}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {sources.map((key) => (
            <SortableProfileSourceRow
              key={key}
              id={key}
              onRemove={() => setSources((prev) => prev.filter((k) => k !== key))}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export default function AdminConfigShell() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pool, setPool] = useState<PoolRecord>({});
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [adminPwdOk, setAdminPwdOk] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const [pwdCurrent, setPwdCurrent] = useState('');
  const [pwdNew, setPwdNew] = useState('');
  const [pwdRepeat, setPwdRepeat] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [poolModalOriginalKey, setPoolModalOriginalKey] = useState<string | null>(null);
  const [poolDraftName, setPoolDraftName] = useState('');
  const [poolDraftUrl, setPoolDraftUrl] = useState('');
  const [poolDraftUa, setPoolDraftUa] = useState('');
  const [poolDraftDisabled, setPoolDraftDisabled] = useState(false);

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileDraftIndex, setProfileDraftIndex] = useState<number | null>(null);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [profileDraftToken, setProfileDraftToken] = useState('');
  const [profileDraftSources, setProfileDraftSources] = useState<string[]>([]);

  const [pendingDeletePool, setPendingDeletePool] = useState<string | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/config', { method: 'GET' });
      const data = (await res.json()) as ApiConfig | { error?: string };
      if (!res.ok) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setAdminPwdOk(Boolean((data as ApiConfig).adminPasswordConfigured));
      setPool({ ...(data as ApiConfig).subscriptionPool });
      setProfiles([...(data as ApiConfig).profiles]);
    } catch {
      setNotice({ tone: 'err', text: '加载配置失败' });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  async function persistAll(poolNext: PoolRecord, profilesNext: ProfileRow[]) {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subscriptionPool: poolNext,
          profiles: profilesNext,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setNotice({
          tone: 'err',
          text: typeof err?.message === 'string' ? err.message : '保存失败，请核对校验错误',
        });
        return false;
      }
      setPool(poolNext);
      setProfiles(profilesNext);
      setNotice({ tone: 'ok', text: '已保存到磁盘' });
      return true;
    } finally {
      setSaving(false);
    }
  }

  function openPoolAdd() {
    setPoolModalOriginalKey(null);
    setPoolDraftName('');
    setPoolDraftUrl('');
    setPoolDraftUa('');
    setPoolDraftDisabled(false);
    setPoolModalOpen(true);
  }

  function openPoolEdit(key: string) {
    const row = pool[key];
    setPoolModalOriginalKey(key);
    setPoolDraftName(key);
    setPoolDraftUrl(row.url);
    setPoolDraftUa(row.userAgent ?? '');
    setPoolDraftDisabled(row.disabled ?? false);
    setPoolModalOpen(true);
  }

  function migratePoolRename(oldKey: string, newKey: string, nextProfiles: ProfileRow[]): ProfileRow[] {
    return nextProfiles.map((p) => ({
      ...p,
      sources: p.sources.map((name) => (name === oldKey ? newKey : name)),
    }));
  }

  async function confirmPoolModal() {
    const nameTrim = poolDraftName.trim();
    const urlTrim = poolDraftUrl.trim();
    const uaTrim = poolDraftUa.trim();

    if (!nameTrim || !urlTrim) {
      setNotice({ tone: 'err', text: '链接池条目需要填写「名称」和「订阅地址」。' });
      return;
    }

    const nextProfiles = [...profiles];

    let nextPool: PoolRecord = { ...pool };
    let profilesAfterMigrate = nextProfiles;

    const originalKey = poolModalOriginalKey;

    if (originalKey !== null && originalKey !== nameTrim) {
      if (nextPool[nameTrim]) {
        setNotice({ tone: 'err', text: '该链接池名称已存在。' });
        return;
      }
      const copied = nextPool[originalKey];
      if (!copied) {
        return;
      }
      delete nextPool[originalKey];
      nextPool[nameTrim] = { ...copied, url: urlTrim, userAgent: uaTrim, disabled: poolDraftDisabled };
      profilesAfterMigrate = migratePoolRename(originalKey, nameTrim, nextProfiles);
    } else if (originalKey !== null && originalKey === nameTrim) {
      nextPool[nameTrim] = { url: urlTrim, disabled: poolDraftDisabled, userAgent: uaTrim };
      profilesAfterMigrate = nextProfiles;
    } else {
      if (nextPool[nameTrim]) {
        setNotice({ tone: 'err', text: '该链接池名称已存在。' });
        return;
      }
      nextPool[nameTrim] = {
        url: urlTrim,
        disabled: poolDraftDisabled,
        userAgent: uaTrim,
      };
      profilesAfterMigrate = nextProfiles;
    }

    setPool(nextPool);
    setProfiles(profilesAfterMigrate);

    await persistAll(nextPool, profilesAfterMigrate);
    setPoolModalOpen(false);
  }

  async function deletePoolConfirmed(key: string) {
    const nextPool = { ...pool };
    delete nextPool[key];
    const nextProfiles = profiles
      .map((row) => ({
        ...row,
        sources: row.sources.filter((name) => name !== key),
      }))
      .filter((row) => row.sources.length > 0);
    await persistAll(nextPool, nextProfiles);
    setPendingDeletePool(null);
  }

  function openProfile(add: boolean, index?: number) {
    if (add || index == null) {
      setProfileDraftIndex(null);
      setProfileDraftName('');
      setProfileDraftToken('');
      setProfileDraftSources([]);
    } else {
      const row = profiles[index];
      setProfileDraftIndex(index);
      setProfileDraftName(row.name?.trim() ?? '');
      setProfileDraftToken(row.token);
      setProfileDraftSources([...row.sources]);
    }
    setProfileModalOpen(true);
  }

  async function saveProfileDraft() {
    const tokenTrim = profileDraftToken.trim();
    const keys = sortedPoolKeys(pool);
    const ordered = orderedSourcesForSave(profileDraftSources, keys);
    if (!tokenTrim || ordered.length === 0) {
      setNotice({
        tone: 'err',
        text: '客户配置需要填写「令牌」并至少选择 1 个订阅源（可拖拽调整合并顺序）。',
      });
      return;
    }
    let nextProfiles: ProfileRow[];

    const duplicateOthers = profiles.some(
      (p, idx) => p.token === tokenTrim && (profileDraftIndex == null || idx !== profileDraftIndex),
    );

    if (duplicateOthers) {
      setNotice({ tone: 'err', text: '令牌已存在，不能与另一个客户冲突。' });
      return;
    }

    const nameTrim = profileDraftName.trim();
    const rowDef: ProfileRow = {
      token: tokenTrim,
      sources: ordered,
      ...(nameTrim ? { name: nameTrim } : {}),
    };
    if (profileDraftIndex == null) {
      nextProfiles = [...profiles, rowDef];
    } else {
      nextProfiles = profiles.slice();
      nextProfiles.splice(profileDraftIndex, 1, rowDef);
    }

    await persistAll(pool, nextProfiles);
    setProfileModalOpen(false);
  }

  async function deleteProfileConfirmed(idx: number) {
    const nextProfiles = profiles.filter((_, i) => i !== idx);
    await persistAll(pool, nextProfiles);
    setPendingDeleteProfile(null);
  }

  async function submitPasswordChange() {
    setPwdBusy(true);
    setNotice(null);
    try {
      if (!pwdCurrent || !pwdNew || pwdNew !== pwdRepeat) {
        setNotice({ tone: 'err', text: '请输入当前密码与新密码，并确认两次新密码一致。' });
        return;
      }

      const res = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: pwdCurrent, newPassword: pwdNew }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          typeof data?.message === 'string' ? data.message : '修改失败（请核对当前密码或配置）';
        setNotice({ tone: 'err', text: msg });
        return;
      }

      setPwdCurrent('');
      setPwdNew('');
      setPwdRepeat('');
      setNotice({ tone: 'ok', text: '管理密码已更新，请改用新密码重新登录更安全。' });
      void reload();
    } finally {
      setPwdBusy(false);
    }
  }

  async function persistPoolDisabled(key: string, disabled: boolean) {
    const nextPool = {
      ...pool,
      [key]: { ...pool[key], disabled },
    };
    await persistAll(nextPool, profiles);
  }

  return (
    <Cursor>
      <main style={{ padding: '28px 16px 40px', maxWidth: 1040, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <Card type="title" style={{ flex: '1 1 auto' }}>
            🏠 控制台 · 订阅与链接池配置
          </Card>
          <ThemeToggle />
          <Button type="dashed" onClick={() => void reload()} disabled={loading}>
            {loading ? '加载中…' : '刷新'}
          </Button>
          <Button onClick={() => void logout()}>退出登录</Button>
        </div>

        <Card color={notice?.tone === 'ok' ? 'app-teal' : notice?.tone === 'err' ? 'app-red' : 'warm-peach-pink'}>
          {notice
            ? notice.text
            : loading
              ? '正在加载配置……'
              : '提示：在客户档案中按「合并顺序」拖拽排列链接池；合并时从左到右依次抓取。禁用链接池仍可保留配置但不会参与抓取。'}
        </Card>

        {adminPwdOk === false ? (
          <Card color="app-yellow" style={{ marginTop: 12 }}>
            当前未检测到有效的 adminPassword（或仅环境变量 ADMIN_PASSWORD）。请尽快在「密码」分区设置或手动写入配置文件。
          </Card>
        ) : null}

        <Divider type="wave-yellow" style={{ marginTop: 18, marginBottom: 18 }} />

        <IslandTabs
          defaultActiveKey="pool"
          items={[
            {
              key: 'pool',
              label: '链接池',
              children: (
                <div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
                    <Button type="primary" onClick={openPoolAdd}>
                      新建链接池条目
                    </Button>
                  </div>
                  {sortedPoolKeys(pool).map((key) => (
                    <Card key={key} type="dashed" style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <Card type="title" style={{ margin: 0 }}>
                          {key}
                        </Card>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <Switch
                            checked={!(pool[key]?.disabled ?? false)}
                            checkedChildren="启用"
                            unCheckedChildren="禁用"
                            onChange={(enabled) => void persistPoolDisabled(key, !enabled)}
                          />
                          <Button type="dashed" size="small" style={poolRowPillButtonStyle} onClick={() => openPoolEdit(key)}>
                            修改
                          </Button>
                          <Button type="primary" danger size="small" style={poolRowPillButtonStyle} onClick={() => setPendingDeletePool(key)}>
                            删除
                          </Button>
                        </div>
                      </div>
                      <Divider type="line-brown" style={{ marginTop: 8, marginBottom: 16 }} />
                      <div style={{ display: 'grid', gap: 8 }}>
                        <div>
                          <span style={{ fontWeight: 600 }}>地址：</span>
                          <span style={{ wordBreak: 'break-all' }}>{pool[key]?.url}</span>
                        </div>
                        <div>
                          <span style={{ fontWeight: 600 }}>UA：</span>
                          <span>{pool[key]?.userAgent ?? ''}</span>
                        </div>
                      </div>
                    </Card>
                  ))}
                  {sortedPoolKeys(pool).length === 0 ? (
                    <Card color="brown">还没有链接池，点击「新建」开始配置。</Card>
                  ) : null}
                </div>
              ),
            },
            {
              key: 'profiles',
              label: '客户配置',
              children: (
                <div>
                  <div style={{ marginBottom: 16 }}>
                    <Button type="primary" onClick={() => openProfile(true)}>
                      新增客户档案
                    </Button>
                  </div>
                  {profiles.map((row, idx) => (
                    <Card key={`${row.token}-${idx}`} type="dashed" style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <div>
                          {row.name ? (
                            <>
                              <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>{row.name}</div>
                              <div style={{ marginTop: 4, opacity: 0.88, fontSize: 13 }}>令牌 · {row.token}</div>
                            </>
                          ) : (
                            <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>{row.token}</div>
                          )}
                          <div style={{ marginTop: 6, opacity: 0.92 }}>{row.sources.join(' → ')}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Button type="dashed" onClick={() => openProfile(false, idx)}>
                            编辑
                          </Button>
                          <Button danger type="primary" onClick={() => setPendingDeleteProfile(idx)}>
                            删除
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                  {profiles.length === 0 ? (
                    <Card color="brown">暂时没有客户条目，可先配置链接池，再在此处绑定。</Card>
                  ) : null}
                </div>
              ),
            },
            {
              key: 'password',
              label: '管理密码',
              children: (
                <Card type="dashed" style={{ padding: '17px 14px 16px', boxSizing: 'border-box' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <label style={{ display: 'block', fontWeight: 700 }}>当前密码</label>
                      <Input
                        allowClear
                        type="password"
                        size="large"
                        value={pwdCurrent}
                        onChange={(ev) => setPwdCurrent(ev.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <label style={{ display: 'block', fontWeight: 700 }}>新密码</label>
                      <Input
                        allowClear
                        type="password"
                        size="large"
                        value={pwdNew}
                        onChange={(ev) => setPwdNew(ev.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <label style={{ display: 'block', fontWeight: 700 }}>确认新密码</label>
                      <Input
                        allowClear
                        type="password"
                        size="large"
                        value={pwdRepeat}
                        onChange={(ev) => setPwdRepeat(ev.target.value)}
                      />
                    </div>
                    <div style={{ paddingTop: 6 }}>
                      <Button type="primary" loading={pwdBusy} onClick={() => void submitPasswordChange()}>
                        更新管理密码
                      </Button>
                    </div>
                  </div>
                </Card>
              ),
            },
          ]}
        />

        <Modal
          typewriter={false}
          open={poolModalOpen}
          className="admin-animal-modal"
          title={poolModalOriginalKey ? `编辑链接池 · ${poolModalOriginalKey}` : '新建链接池'}
          width={620}
          onClose={() => setPoolModalOpen(false)}
          footer={
            <>
              <Button onClick={() => setPoolModalOpen(false)} type="default">
                取消
              </Button>
              <Button type="primary" loading={saving} onClick={() => void confirmPoolModal()}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </>
          }
        >
          <label style={modalFormLabelStyle}>名称（键）</label>
          <Input allowClear style={{ marginBottom: 12 }} value={poolDraftName} onChange={(e) => setPoolDraftName(e.target.value)} />
          <label style={{ ...modalFormLabelStyle, ...modalFormSectionStyle }}>订阅地址（或内联 URI）</label>
          <Input
            allowClear
            style={{ marginBottom: 12 }}
            placeholder="https://..."
            value={poolDraftUrl}
            onChange={(e) => setPoolDraftUrl(e.target.value)}
          />
          <label style={{ ...modalFormLabelStyle, ...modalFormSectionStyle }}>User-Agent（可留空）</label>
          <Input allowClear style={{ marginBottom: 12 }} value={poolDraftUa} onChange={(e) => setPoolDraftUa(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...modalFormSectionStyle }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>启用此源</span>
            <Switch
              checked={!poolDraftDisabled}
              checkedChildren="启用"
              unCheckedChildren="禁用"
              onChange={(enabled) => setPoolDraftDisabled(!enabled)}
            />
          </div>
        </Modal>

        <Modal
          typewriter={false}
          open={profileModalOpen}
          className="admin-animal-modal"
          title={
            <span style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>
              {profileDraftIndex === null ? '新增客户档案' : '编辑客户档案'}
            </span>
          }
          width={760}
          onClose={() => setProfileModalOpen(false)}
          footer={
            <>
              <Button type="default" onClick={() => setProfileModalOpen(false)}>
                关闭
              </Button>
              <Button type="primary" loading={saving} onClick={() => void saveProfileDraft()}>
                {saving ? '保存中…' : '保存档案'}
              </Button>
            </>
          }
        >
          <label style={modalFormLabelStyle}>客户名称（可选，仅用于控制台展示）</label>
          <Input
            allowClear
            style={{ marginBottom: 12 }}
            placeholder="例如：公司 A、家用"
            value={profileDraftName}
            onChange={(e) => setProfileDraftName(e.target.value)}
          />
          <label style={{ ...modalFormLabelStyle, ...modalFormSectionStyle }}>客户令牌 · /sub?token</label>
          <Input
            allowClear
            style={{ marginBottom: 12 }}
            value={profileDraftToken}
            onChange={(e) => setProfileDraftToken(e.target.value)}
            suffix={
              <Button
                type="dashed"
                size="small"
                style={inputSuffixCompactButtonStyle}
                onClick={() => setProfileDraftToken(randomProfileToken8())}
              >
                随机8位
              </Button>
            }
          />
          <label style={{ ...modalFormLabelStyle, ...modalFormSectionStyle }}>
            订阅合并顺序（拖动标签区域排序，「移除」不受影响）
          </label>
          {profileDraftSources.length === 0 ? (
            <div style={{ marginBottom: 12, fontSize: 13 }}>
              <Card color="brown">暂无来源，请从下方「添加订阅源」中加入链接池。</Card>
            </div>
          ) : (
            <ProfileDraftSourcesSortable sources={profileDraftSources} setSources={setProfileDraftSources} />
          )}
          {sortedPoolKeys(pool).length === 0 ? (
            <Card color="brown">请先在「链接池」页新建至少一个订阅源。</Card>
          ) : (
            <>
              <label style={modalFormLabelStyle}>添加订阅源</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {sortedPoolKeys(pool)
                  .filter((k) => !profileDraftSources.includes(k))
                  .map((key) => (
                    <Button
                      key={key}
                      type="dashed"
                      size="small"
                      style={poolRowPillButtonStyle}
                      onClick={() => setProfileDraftSources((prev) => [...prev, key])}
                    >
                      + {key}
                    </Button>
                  ))}
              </div>
              {sortedPoolKeys(pool).every((k) => profileDraftSources.includes(k)) ? (
                <div style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>已包含全部链接池。</div>
              ) : null}
            </>
          )}
        </Modal>

        <Modal
          typewriter={false}
          open={Boolean(pendingDeletePool)}
          className="admin-animal-modal"
          title="删除链接池条目？"
          footer={
            <>
              <Button type="default" onClick={() => setPendingDeletePool(null)}>
                算了
              </Button>
              <Button
                danger
                type="primary"
                disabled={pendingDeletePool == null}
                onClick={() => {
                  const key = pendingDeletePool;
                  if (key != null) {
                    void deletePoolConfirmed(key);
                  }
                }}
              >
                确认删除
              </Button>
            </>
          }
          onClose={() => setPendingDeletePool(null)}
        >
          所有客户配置中引用到这个名称的记录都会被移除。<div style={{ marginTop: 14 }}>{pendingDeletePool}</div>
        </Modal>

        <Modal
          typewriter={false}
          open={pendingDeleteProfile != null}
          className="admin-animal-modal"
          title="永久删除这份客户档案？"
          footer={
            <>
              <Button type="default" onClick={() => setPendingDeleteProfile(null)}>
                取消
              </Button>
              <Button danger type="primary" onClick={() => pendingDeleteProfile != null && void deleteProfileConfirmed(pendingDeleteProfile)}>
                是的，删除它
              </Button>
            </>
          }
          onClose={() => setPendingDeleteProfile(null)}
        >
          {pendingDeleteProfile != null ? (
            <>
              {profiles[pendingDeleteProfile]?.name ? (
                <div style={{ marginBottom: 8 }}>
                  名称：<strong>{profiles[pendingDeleteProfile]?.name}</strong>
                </div>
              ) : null}
              <div>令牌：{profiles[pendingDeleteProfile]?.token ?? '—'}</div>
            </>
          ) : (
            '—'
          )}
        </Modal>

        <Divider type="wave-yellow" style={{ marginTop: 20 }} />
        <Footer type="sea" />
      </main>
    </Cursor>
  );
}

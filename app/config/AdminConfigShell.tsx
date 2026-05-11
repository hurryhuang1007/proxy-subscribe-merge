'use client';

import { IslandTabs } from '@/app/config/IslandTabs';
import {
  Button,
  Card,
  Checkbox,
  Cursor,
  Divider,
  Footer,
  Input,
  Modal,
  Switch,
} from 'animal-island-ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

type PoolRecord = Record<string, { url: string; disabled: boolean; userAgent: string }>;
type ProfileRow = { token: string; sources: string[] };

type ApiConfig = {
  subscriptionPool: PoolRecord;
  profiles: ProfileRow[];
  adminPasswordConfigured: boolean;
};

function sortedPoolKeys(pool: PoolRecord): string[] {
  return Object.keys(pool).sort((a, b) => a.localeCompare(b));
}

function normalizeSources(selection: Array<string | number>, poolKeys: string[]) {
  const set = new Set(selection.map(String));
  return poolKeys.filter((key) => set.has(key));
}

/** 与 animal-island Switch 胶囊形态一致（库内 small 按钮默认圆角偏小） */
const poolRowPillButtonStyle = { borderRadius: 9999 } as const;

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
  const [profileDraftToken, setProfileDraftToken] = useState('');
  const [profileDraftSources, setProfileDraftSources] = useState<Array<string | number>>([]);

  const [pendingDeletePool, setPendingDeletePool] = useState<string | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<number | null>(null);

  const checkboxOptions = useMemo(
    () => sortedPoolKeys(pool).map((key) => ({ label: key, value: key })),
    [pool],
  );

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
        token: row.token,
        sources: row.sources.filter((name) => name !== key),
      }))
      .filter((row) => row.sources.length > 0);
    await persistAll(nextPool, nextProfiles);
    setPendingDeletePool(null);
  }

  function openProfile(add: boolean, index?: number) {
    if (add || index == null) {
      setProfileDraftIndex(null);
      setProfileDraftToken('');
      setProfileDraftSources([]);
    } else {
      const row = profiles[index];
      setProfileDraftIndex(index);
      setProfileDraftToken(row.token);
      setProfileDraftSources([...row.sources]);
    }
    setProfileModalOpen(true);
  }

  async function saveProfileDraft() {
    const tokenTrim = profileDraftToken.trim();
    const keys = sortedPoolKeys(pool);
    const ordered = normalizeSources(profileDraftSources, keys);
    if (!tokenTrim || ordered.length === 0) {
      setNotice({
        tone: 'err',
        text: '客户配置需要填写「令牌」并在链接池中至少勾选 1 个订阅源。',
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

    const rowDef: ProfileRow = { token: tokenTrim, sources: ordered };
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
          <Button type="dashed" onClick={() => void reload()} disabled={loading}>
            {loading ? '加载中…' : '刷新'}
          </Button>
          <Button onClick={() => void logout()}>退出登录</Button>
        </div>

        <Card color={notice?.tone === 'ok' ? 'app-teal' : notice?.tone === 'err' ? 'app-red' : 'warm-peach-pink'}>
          {notice ? notice.text : loading ? '正在加载配置……' : '提示：勾选客户的订阅来源会按从左到右的链接池排序合并。禁用链接池仍可保留配置但不会参与抓取。'}
        </Card>

        {adminPwdOk === false ? (
          <Card color="app-yellow" style={{ marginTop: 12 }}>
            当前未检测到有效的 adminPassword（或仅环境变量 ADMIN_PASSWORD）。请尽快在「密码」分区设置或手动写入配置文件。
          </Card>
        ) : null}

        <Divider type="wave-yellow" />

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
                      <Divider type="line-brown" />
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
                          <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>{row.token}</div>
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
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>名称（键）</label>
          <Input allowClear style={{ marginBottom: 14 }} value={poolDraftName} onChange={(e) => setPoolDraftName(e.target.value)} />
          <label style={{ display: 'block', marginTop: 22, marginBottom: 8, fontWeight: 700 }}>订阅地址（或内联 URI）</label>
          <Input
            allowClear
            style={{ marginBottom: 14 }}
            placeholder="https://..."
            value={poolDraftUrl}
            onChange={(e) => setPoolDraftUrl(e.target.value)}
          />
          <label style={{ display: 'block', marginTop: 22, marginBottom: 8, fontWeight: 700 }}>User-Agent（可留空）</label>
          <Input allowClear style={{ marginBottom: 14 }} value={poolDraftUa} onChange={(e) => setPoolDraftUa(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22 }}>
            <span style={{ fontWeight: 700 }}>启用此源</span>
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
          title={profileDraftIndex === null ? '新增客户档案' : '编辑客户档案'}
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
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>客户令牌 · /sub?token</label>
          <Input allowClear size="large" style={{ marginBottom: 14 }} value={profileDraftToken} onChange={(e) => setProfileDraftToken(e.target.value)} />
          <label style={{ display: 'block', marginTop: 22, marginBottom: 8, fontWeight: 700 }}>
            订阅合并顺序（勾选链接池名称）
          </label>
          <Checkbox
            direction="vertical"
            options={checkboxOptions}
            size="middle"
            value={profileDraftSources}
            onChange={(vals) => setProfileDraftSources(vals)}
          />
        </Modal>

        <Modal
          typewriter={false}
          open={Boolean(pendingDeletePool)}
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
          令牌：{pendingDeleteProfile != null ? profiles[pendingDeleteProfile]?.token ?? '—' : '—'}
        </Modal>

        <Divider type="wave-yellow" />
        <Footer type="sea" />
      </main>
    </Cursor>
  );
}

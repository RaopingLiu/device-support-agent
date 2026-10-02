# 业务规则测试：验证参数化 SQL、场景隔离、草稿版本和工单事务约束。
import concurrent.futures
import pytest
from app import db,tickets
from app.tools import device_search,make_tools

# 构造有效演示草稿，不同测试只覆盖需要变化的字段。
def payload(**updates):
    return {'site_id':'S01','summary':'仓储区无线掉线','description':'多台手持终端无法稳定连接无线网络','area':'仓储区','device_ids':['S01-AP04'],**updates}

# 读取正式工单数，断言草稿操作不会意外产生正式记录。
def count():
    with db.connect() as c:return c.execute('SELECT count(*) FROM tickets').fetchone()[0]

# 草稿不计作正式工单，取消后不能继续确认。
def test_draft_is_not_ticket_and_cancel_blocks_submission(store):
    d=tickets.prepare(store,payload());assert count()==0
    tickets.mutate(store,d['draft_id'],1,'cancel')
    with pytest.raises(tickets.Conflict):tickets.mutate(store,d['draft_id'],1,'confirm')
    assert count()==0

# 修改使旧版本失效；同版本重复确认只产生一份工单。
def test_edit_stale_confirmation_and_idempotency(store):
    d=tickets.prepare(store,payload());did=d['draft_id']
    tickets.mutate(store,did,1,'edit',payload(summary='修改后的无线报障'))
    with pytest.raises(tickets.Conflict):tickets.mutate(store,did,1,'confirm')
    assert count()==0
    first=tickets.mutate(store,did,2,'confirm');second=tickets.mutate(store,did,2,'confirm')
    assert first['ticket_id']==second['ticket_id'];assert count()==1
    assert tickets.get(store,first['ticket_id'])['payload']['summary']=='修改后的无线报障'

# 并发确认同一草稿，核对最终正式记录只有一份。
def test_concurrent_confirmation_creates_one_ticket(store):
    d=tickets.prepare(store,payload())
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        ids=list(pool.map(lambda _:tickets.mutate(store,d['draft_id'],1,'confirm')['ticket_id'],range(4)))
    assert len(set(ids))==1;assert count()==1

# 阻止跨会话操作以及关联其他站点的设备。
def test_foreign_session_and_wrong_site(store):
    d=tickets.prepare(store,payload());other=db.new_session('normal')
    with pytest.raises(LookupError):tickets.mutate(other,d['draft_id'],1,'confirm')
    with pytest.raises(ValueError):tickets.prepare(store,payload(device_ids=['S02-AP04']))
    t=tickets.mutate(store,d['draft_id'],1,'confirm')
    with pytest.raises(LookupError):tickets.get(other,t['ticket_id'])

# 用特殊输入检查 SQL 参数绑定，并核对分页行为。
def test_sql_is_parameterized_and_paginated(store):
    assert device_search(site_id="S01' OR 1=1 --")['total']==0
    first=device_search(limit=20);second=device_search(limit=20,offset=first['next_offset'])
    assert first['total']==140
    assert not {x['device_id'] for x in first['devices']} & {x['device_id'] for x in second['devices']}
    assert device_search(site_id='S01',device_type='ap')['total']==9

# 同设备不同案例互不干扰，未知编号必须明确返回未找到。
def test_scenarios_are_isolated_and_missing_device_explicit(store):
    other=db.new_session('normal')
    a={x.name:x for x in make_tools(store)};b={x.name:x for x in make_tools(other)}
    assert a['get_device_status'].invoke({'device_id':'S01-AP04'})['data']['online_state']=='offline'
    assert b['get_device_status'].invoke({'device_id':'S01-AP04'})['data']['online_state']=='online'
    assert a['get_device_status'].invoke({'device_id':'FAKE'})['status']=='not_found'
    assert a['get_device_status'].invoke({'device_id':'S01-AP04'})['data']['is_simulated'] is True

# 新草稿生成后，旧草稿的确认请求应被拒绝。
def test_replacing_draft_invalidates_old_confirmation(store):
    first=tickets.prepare(store,payload());second=tickets.prepare(store,payload(summary='补充后的故障'))
    with pytest.raises(tickets.Conflict):tickets.mutate(store,first['draft_id'],1,'confirm')
    assert tickets.current(store)['draft_id']==second['draft_id'];assert count()==0

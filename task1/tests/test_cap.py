from sqlalchemy import update

from app.models import Account
from conftest import days_ago, make_event, post_event, usage


def set_cap(db, minutes, account_id="acct_001"):
    db.execute(update(Account).where(Account.id == account_id).values(monthly_minutes_cap=minutes))
    db.commit()


def start_call(client, **overrides):
    return post_event(client, make_event(event_type="call.started", duration_seconds=0, cost_cents=0, **overrides))


def end_call(client, minutes, **overrides):
    return post_event(client, make_event(event_type="call.ended", duration_seconds=minutes * 60, **overrides))


def test_new_calls_are_allowed_below_the_cap(client, db):
    start_call(client)  # creates the account
    set_cap(db, 10)
    end_call(client, 9)
    assert start_call(client).status_code == 200
    assert usage(client)["cap_exceeded"] is False


def test_new_calls_are_blocked_exactly_at_the_cap(client, db):
    start_call(client)
    set_cap(db, 10)
    end_call(client, 10)

    response = start_call(client)

    assert response.status_code == 409
    assert usage(client)["cap_exceeded"] is True


def test_calls_in_progress_can_still_end_above_the_cap(client, db):
    start_call(client)
    set_cap(db, 10)
    end_call(client, 10)

    assert end_call(client, 5).status_code == 200
    assert usage(client)["minutes"] == 15


def test_cap_engages_partway_through_a_burst(client, db):
    start_call(client)
    set_cap(db, 100)
    statuses = []
    for _ in range(40):
        statuses.append(start_call(client).status_code)
        end_call(client, 10)

    assert statuses[0] == 200
    assert statuses[-1] == 409
    assert statuses.index(409) == 10  # 10 calls x 10 minutes reaches the cap of 100


def test_other_accounts_are_not_affected(client, db):
    start_call(client)
    set_cap(db, 5)
    end_call(client, 5)

    assert start_call(client).status_code == 409
    assert start_call(client, account_id="acct_002").status_code == 200


def test_late_events_do_not_trigger_this_months_cap(client, db):
    start_call(client)
    set_cap(db, 5)
    end_call(client, 60, timestamp=days_ago(35))  # last month's usage

    assert start_call(client).status_code == 200
